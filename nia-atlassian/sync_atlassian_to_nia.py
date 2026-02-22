#!/usr/bin/env python3
"""Fetch Confluence/Jira content and index selected items into Nia.

Examples:
  python sync_atlassian_to_nia.py confluence --space ENG --limit 20
  python sync_atlassian_to_nia.py jira --jql "project = ENG ORDER BY updated DESC" --limit 20
  python sync_atlassian_to_nia.py confluence --space ENG --pick "1,2,5" --source-name "ENG Confluence"
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

NIA_BASE_URL = "https://apigcp.trynia.ai/v2"
DEFAULT_TIMEOUT = 30


@dataclass
class AtlassianConfig:
    base_url: str
    email: str
    api_token: str


@dataclass
class NiaConfig:
    api_key: str


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _normalize_nia_key(raw: str) -> str:
    token = (raw or "").strip().strip("\"'").strip()
    for prefix in ("Bearer ", "bearer ", "Token ", "token "):
        if token.startswith(prefix):
            token = token[len(prefix):].strip()
    return token


def _load_configs() -> tuple[AtlassianConfig, NiaConfig]:
    here = Path(__file__).resolve().parent
    load_dotenv(here / ".env")

    atlassian = AtlassianConfig(
        base_url=_env("ATLASSIAN_BASE_URL"),
        email=_env("ATLASSIAN_EMAIL"),
        api_token=_env("ATLASSIAN_API_TOKEN"),
    )
    nia = NiaConfig(api_key=_normalize_nia_key(_env("NIA_API_KEY")))

    missing = []
    if not atlassian.base_url:
        missing.append("ATLASSIAN_BASE_URL")
    if not atlassian.email:
        missing.append("ATLASSIAN_EMAIL")
    if not atlassian.api_token:
        missing.append("ATLASSIAN_API_TOKEN")
    if not nia.api_key:
        missing.append("NIA_API_KEY")

    if missing:
        raise SystemExit("Missing required environment variables: " + ", ".join(missing))

    return atlassian, nia


def _auth(cfg: AtlassianConfig) -> tuple[str, str]:
    return (cfg.email, cfg.api_token)


def _http_get(cfg: AtlassianConfig, path: str, params: dict[str, Any]) -> dict[str, Any]:
    base = cfg.base_url.rstrip("/")
    url = f"{base}{path}"
    resp = requests.get(
        url,
        params=params,
        auth=_auth(cfg),
        headers={"Accept": "application/json"},
        timeout=DEFAULT_TIMEOUT,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"GET {url} failed: {resp.status_code} {resp.text[:300]}")
    return resp.json()


def _nia_request(
    method: str,
    path: str,
    nia_cfg: NiaConfig,
    *,
    json_body: dict[str, Any] | None = None,
) -> requests.Response:
    token = _normalize_nia_key(nia_cfg.api_key)
    if not token:
        raise RuntimeError("NIA_API_KEY is empty after normalization")
    url = f"{NIA_BASE_URL}{path}"
    auth_headers = [
        {"Authorization": f"Bearer {token}", "x-api-key": token},
        {"Authorization": token, "x-api-key": token},
        {"x-api-key": token},
    ]
    base_headers = {"Accept": "application/json"}
    if json_body is not None:
        base_headers["Content-Type"] = "application/json"

    attempts: list[requests.Response] = []
    for auth in auth_headers:
        headers = dict(base_headers)
        headers.update(auth)
        resp = requests.request(
            method=method,
            url=url,
            headers=headers,
            json=json_body,
            timeout=DEFAULT_TIMEOUT,
            allow_redirects=False,
        )
        # Manually follow one redirect while preserving auth headers.
        if 300 <= resp.status_code < 400 and resp.headers.get("Location"):
            redirected = requests.request(
                method=method,
                url=resp.headers["Location"],
                headers=headers,
                json=json_body,
                timeout=DEFAULT_TIMEOUT,
                allow_redirects=False,
            )
            resp = redirected
        attempts.append(resp)
        if resp.status_code != 401:
            return resp
    # Prefer the most informative 401 instead of always returning the last attempt.
    for resp in attempts:
        text_l = (resp.text or "").lower()
        if "invalid token format" in text_l or "invalid token" in text_l:
            return resp
    return attempts[-1]


def _strip_html(value: str) -> str:
    if not value:
        return ""
    text = re.sub(r"<br\\s*/?>", "\n", value, flags=re.IGNORECASE)
    text = re.sub(r"</p\\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _adf_to_text(node: Any) -> str:
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "".join(_adf_to_text(n) for n in node)
    if not isinstance(node, dict):
        return ""

    ntype = node.get("type", "")
    content = node.get("content", [])

    if ntype == "text":
        return node.get("text", "")
    if ntype in {"paragraph", "heading"}:
        return _adf_to_text(content) + "\n"
    if ntype in {"bulletList", "orderedList"}:
        return "".join(_adf_to_text(c) for c in content) + "\n"
    if ntype == "listItem":
        body = _adf_to_text(content).strip()
        return f"- {body}\n" if body else ""
    if ntype == "hardBreak":
        return "\n"

    return _adf_to_text(content)


def fetch_confluence(cfg: AtlassianConfig, space: str, cql: str, limit: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    start = 0
    page_size = min(max(limit, 1), 100)

    while len(items) < limit:
        params = {
            "type": "page",
            "limit": min(page_size, limit - len(items)),
            "start": start,
            "expand": "space,version,body.storage",
        }
        if space:
            params["spaceKey"] = space
        if cql:
            params["cql"] = cql

        data = _http_get(cfg, "/wiki/rest/api/content", params)
        results = data.get("results", [])
        if not results:
            break

        for p in results:
            links = p.get("_links", {})
            webui = links.get("webui", "")
            page_url = cfg.base_url.rstrip("/") + webui if webui else ""
            storage = p.get("body", {}).get("storage", {}).get("value", "")
            text = _strip_html(storage)
            items.append(
                {
                    "kind": "confluence",
                    "id": str(p.get("id", "")),
                    "title": p.get("title", "(untitled)"),
                    "url": page_url,
                    "space": p.get("space", {}).get("key", ""),
                    "updated": p.get("version", {}).get("when", ""),
                    "content": text,
                }
            )

        start += len(results)

    return items[:limit]


def fetch_jira(cfg: AtlassianConfig, jql: str, limit: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    start_at = 0
    page_size = min(max(limit, 1), 100)

    while len(items) < limit:
        params = {
            "jql": jql,
            "startAt": start_at,
            "maxResults": min(page_size, limit - len(items)),
            "fields": "summary,description,status,issuetype,project,updated",
        }
        data = _http_get(cfg, "/rest/api/3/search", params)
        issues = data.get("issues", [])
        if not issues:
            break

        for issue in issues:
            fields = issue.get("fields", {})
            key = issue.get("key", "")
            url = f"{cfg.base_url.rstrip('/')}/browse/{key}" if key else ""
            desc = _adf_to_text(fields.get("description"))
            items.append(
                {
                    "kind": "jira",
                    "id": key,
                    "title": fields.get("summary", "(no summary)"),
                    "url": url,
                    "project": fields.get("project", {}).get("key", ""),
                    "status": fields.get("status", {}).get("name", ""),
                    "updated": fields.get("updated", ""),
                    "content": desc.strip(),
                }
            )

        start_at += len(issues)

    return items[:limit]


def _slug(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", (text or "").strip()).strip("-").lower()
    return s[:80] or "item"


def _render_markdown(item: dict[str, Any]) -> str:
    lines = [
        f"# {item.get('title', '(untitled)')}",
        "",
        f"- kind: {item.get('kind', '')}",
        f"- id: {item.get('id', '')}",
        f"- updated: {item.get('updated', '')}",
        f"- url: {item.get('url', '')}",
    ]

    if item.get("space"):
        lines.append(f"- space: {item.get('space')}")
    if item.get("project"):
        lines.append(f"- project: {item.get('project')}")
    if item.get("status"):
        lines.append(f"- status: {item.get('status')}")

    lines += ["", "## Content", "", item.get("content", "(empty)")]
    return "\n".join(lines).strip() + "\n"


def _to_file_items(items: list[dict[str, Any]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for item in items:
        kind = item.get("kind", "item")
        ident = _slug(str(item.get("id", "")))
        title = _slug(str(item.get("title", "")))
        path = f"{kind}/{ident}-{title}.md"
        out.append({"path": path, "content": _render_markdown(item)})
    return out


def _pick_items(items: list[dict[str, Any]], pick: str, all_items: bool) -> list[dict[str, Any]]:
    if not items:
        return []
    if all_items:
        return items

    print("\nFetched items:")
    for i, item in enumerate(items, 1):
        id_or_key = item.get("id", "")
        print(f"{i:>3}. [{id_or_key}] {item.get('title', '(untitled)')}")

    chosen = pick.strip()
    if not chosen:
        if not sys.stdin.isatty():
            raise SystemExit("No TTY for selection. Pass --pick \"1,2\" or --all.")
        chosen = input("\nChoose items by number (e.g. 1,2,5): ").strip()

    if not chosen:
        return []

    selected: list[dict[str, Any]] = []
    idxs = set()
    for part in chosen.split(","):
        part = part.strip()
        if not part:
            continue
        if not part.isdigit():
            raise SystemExit(f"Invalid selection token: {part}")
        n = int(part)
        if n < 1 or n > len(items):
            raise SystemExit(f"Selection out of range: {n}")
        idxs.add(n - 1)

    for idx in sorted(idxs):
        selected.append(items[idx])
    return selected


def index_selected_in_nia(nia_cfg: NiaConfig, selected: list[dict[str, Any]], source_name: str) -> dict[str, Any]:
    if not selected:
        raise SystemExit("No items selected for indexing")

    files = _to_file_items(selected)
    folder_slug = _slug(source_name).replace("-", "_")
    body = {
        "type": "local_folder",
        "folder_name": source_name,
        # Some Nia deployments crash with Query(None) on omitted folder_path.
        # Supplying an explicit path avoids that server-side serialization bug.
        "folder_path": f"/{folder_slug}",
        "display_name": source_name,
        "add_as_global_source": False,
        "files": files,
    }
    create_resp = _nia_request("POST", "/sources", nia_cfg, json_body=body)
    if create_resp.status_code >= 400:
        raise RuntimeError(
            f"Failed to create Nia source: {create_resp.status_code} {create_resp.text[:500]} "
            f"(payload_keys={sorted(body.keys())}, files={len(files)})"
        )
    result = create_resp.json()
    source_id = result.get("id")
    status = result.get("status")

    # Best-effort poll for readiness.
    if source_id:
        for _ in range(30):
            current_resp = _nia_request("GET", f"/sources/{source_id}", nia_cfg)
            if current_resp.status_code < 400:
                current = current_resp.json()
                status = current.get("status", status)
                if str(status).lower() in {"ready", "indexed", "completed", "active"}:
                    break
                if str(status).lower() in {"failed", "error"}:
                    break
            time.sleep(2)

    return {
        "source_id": source_id,
        "status": status,
        "indexed_count": len(selected),
    }


def _save_snapshot(out_dir: Path, kind: str, items: list[dict[str, Any]], selected: list[dict[str, Any]]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{kind}_fetched.json").write_text(json.dumps(items, indent=2))
    (out_dir / f"{kind}_selected.json").write_text(json.dumps(selected, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Confluence/Jira and index selected items into Nia")
    sub = parser.add_subparsers(dest="kind", required=True)

    p_conf = sub.add_parser("confluence", help="Fetch Confluence pages")
    p_conf.add_argument("--space", default="", help="Confluence space key filter")
    p_conf.add_argument("--cql", default="", help="Confluence CQL filter")
    p_conf.add_argument("--limit", type=int, default=20, help="Max pages to fetch")
    p_conf.add_argument("--source-name", default="atlassian-confluence", help="Nia source display name")
    p_conf.add_argument("--pick", default="", help="1-based indexes to select, e.g. 1,2,5")
    p_conf.add_argument("--all", action="store_true", help="Select all fetched items")
    p_conf.add_argument("--dry-run", action="store_true", help="Fetch/select only; skip Nia indexing")
    p_conf.add_argument("--out-dir", default="nia-atlassian/out", help="Where to write fetched/selected JSON")

    p_jira = sub.add_parser("jira", help="Fetch Jira tickets")
    p_jira.add_argument("--jql", default="ORDER BY updated DESC", help="Jira JQL query")
    p_jira.add_argument("--limit", type=int, default=20, help="Max tickets to fetch")
    p_jira.add_argument("--source-name", default="atlassian-jira", help="Nia source display name")
    p_jira.add_argument("--pick", default="", help="1-based indexes to select, e.g. 1,2,5")
    p_jira.add_argument("--all", action="store_true", help="Select all fetched items")
    p_jira.add_argument("--dry-run", action="store_true", help="Fetch/select only; skip Nia indexing")
    p_jira.add_argument("--out-dir", default="nia-atlassian/out", help="Where to write fetched/selected JSON")

    args = parser.parse_args()

    atlassian_cfg, nia_cfg = _load_configs()

    if args.kind == "confluence":
        items = fetch_confluence(atlassian_cfg, args.space, args.cql, args.limit)
    else:
        items = fetch_jira(atlassian_cfg, args.jql, args.limit)

    print(f"Fetched {len(items)} {args.kind} items")
    selected = _pick_items(items, args.pick, args.all)
    print(f"Selected {len(selected)} item(s)")

    out_dir = Path(args.out_dir)
    _save_snapshot(out_dir, args.kind, items, selected)
    print(f"Saved snapshots to {out_dir}")

    if args.dry_run:
        print("Dry-run mode: skipped Nia indexing")
        return

    result = index_selected_in_nia(nia_cfg, selected, args.source_name)
    print("\nNia indexing result:")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
