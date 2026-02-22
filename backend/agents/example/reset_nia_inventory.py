"""
One-time Nia cleanup script.

What it does:
1) Prints current Nia inventory (repositories + data sources)
2) Deletes all repositories and data sources
3) Prints inventory again

Optional:
- Also delete legacy /v2/sources entities with --include-legacy-sources

Usage:
  cd backend/agents
  source venv/bin/activate
  python example/reset_nia_inventory.py --yes
  python example/reset_nia_inventory.py --yes --include-legacy-sources
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from nia_py import AuthenticatedClient
from nia_py.api.v2_api import (
    delete_data_source_v2_v2_data_sources_source_id_delete as nia_delete_data_source,
    delete_repository_v2_v2_repositories_repository_id_delete as nia_delete_repository,
    delete_source_v2_sources_source_id_delete as nia_delete_source,
    get_repository_tree_v2_v2_repositories_repository_id_tree_get as nia_get_repository_tree,
    list_data_sources_v2_v2_data_sources_get as nia_list_data_sources,
    list_repositories_v2_v2_repositories_get as nia_list_repositories,
    list_sources_v2_sources_get as nia_list_sources,
)

NIA_BASE_URL = "https://apigcp.trynia.ai/v2"


def _safe_attr(obj: Any, keys: list[str]) -> str:
    for key in keys:
        value = getattr(obj, key, None)
        if value is not None:
            return str(value)
    if hasattr(obj, "to_dict"):
        data = obj.to_dict()
        for key in keys:
            if key in data and data[key] is not None:
                return str(data[key])
    return ""


def _print_section(title: str, rows: list[dict]) -> None:
    print(f"\n{title}")
    print("-" * len(title))
    if not rows:
        print("(none)")
        return
    for r in rows:
        print(
            f"- id={r.get('id', '?')}  "
            f"name={r.get('name', '?')}  "
            f"status={r.get('status', '?')}  "
            f"type={r.get('type', '-')}"
        )


def _extract_paths(node: Any, out: set[str]) -> None:
    if isinstance(node, dict):
        for key in ("path", "file_path", "filepath", "name"):
            value = node.get(key)
            if isinstance(value, str):
                out.add(value.lstrip("./"))
        for value in node.values():
            _extract_paths(value, out)
        return
    if isinstance(node, list):
        for item in node:
            _extract_paths(item, out)


def _repo_file_paths(client: AuthenticatedClient, repo_id: str) -> list[str]:
    try:
        tree = nia_get_repository_tree.sync(repository_id=repo_id, client=client)
    except Exception:
        return []

    paths: set[str] = set()
    payload: Any
    if hasattr(tree, "to_dict"):
        payload = tree.to_dict()
    else:
        payload = tree
    _extract_paths(payload, paths)
    return sorted(p for p in paths if p and "/" in p or "." in p)


def _print_repo_files(client: AuthenticatedClient, repos: list[dict], limit: int) -> None:
    print("\nRepository Files (from Nia index)")
    print("--------------------------------")
    if not repos:
        print("(none)")
        return
    for repo in repos:
        rid = repo.get("id", "")
        name = repo.get("name", "?")
        if not rid:
            print(f"- {name}: (missing repository id)")
            continue
        paths = _repo_file_paths(client, rid)
        print(f"- {name} (id={rid}) files={len(paths)}")
        for p in paths[:limit]:
            print(f"    {p}")
        if len(paths) > limit:
            print(f"    ... ({len(paths) - limit} more)")


def _get_client(api_key: str) -> AuthenticatedClient:
    return AuthenticatedClient(base_url=NIA_BASE_URL, token=api_key)


def _list_repositories(client: AuthenticatedClient) -> list[dict]:
    resp = nia_list_repositories.sync(client=client)
    if not isinstance(resp, list):
        return []
    out = []
    for item in resp:
        out.append(
            {
                "id": _safe_attr(item, ["repository_id", "id", "project_id"]),
                "name": _safe_attr(item, ["repository", "name"]),
                "status": _safe_attr(item, ["status"]),
                "type": "repository",
            }
        )
    return out


def _list_data_sources(client: AuthenticatedClient) -> list[dict]:
    resp = nia_list_data_sources.sync(client=client, limit=500, include_tree=False)
    if not isinstance(resp, list):
        return []
    out = []
    for item in resp:
        out.append(
            {
                "id": _safe_attr(item, ["source_id", "id"]),
                "name": _safe_attr(item, ["name", "source_name", "repository"]),
                "status": _safe_attr(item, ["status"]),
                "type": _safe_attr(item, ["source_type", "type"]) or "data_source",
            }
        )
    return out


def _list_legacy_sources(client: AuthenticatedClient) -> list[dict]:
    resp = nia_list_sources.sync(client=client, limit=200)
    if resp is None:
        return []

    # The endpoint returns SourceListResponse with .sources in many SDK versions.
    if hasattr(resp, "sources"):
        items = getattr(resp, "sources") or []
    elif isinstance(resp, dict):
        items = resp.get("sources", [])
    elif hasattr(resp, "to_dict"):
        items = (resp.to_dict() or {}).get("sources", [])
    else:
        items = []

    out = []
    for item in items:
        if isinstance(item, dict):
            out.append(
                {
                    "id": str(item.get("source_id") or item.get("id") or ""),
                    "name": str(item.get("name") or item.get("title") or ""),
                    "status": str(item.get("status") or ""),
                    "type": str(item.get("type") or "legacy_source"),
                }
            )
            continue

        out.append(
            {
                "id": _safe_attr(item, ["source_id", "id"]),
                "name": _safe_attr(item, ["name", "title"]),
                "status": _safe_attr(item, ["status"]),
                "type": _safe_attr(item, ["type"]) or "legacy_source",
            }
        )
    return out


def _delete_repositories(client: AuthenticatedClient, repos: list[dict]) -> tuple[int, int]:
    ok, fail = 0, 0
    for r in repos:
        rid = r.get("id", "")
        if not rid:
            fail += 1
            continue
        resp = nia_delete_repository.sync(repository_id=rid, client=client)
        if resp is None or hasattr(resp, "detail"):
            fail += 1
        else:
            ok += 1
    return ok, fail


def _delete_data_sources(client: AuthenticatedClient, sources: list[dict]) -> tuple[int, int]:
    ok, fail = 0, 0
    for s in sources:
        sid = s.get("id", "")
        if not sid:
            fail += 1
            continue
        resp = nia_delete_data_source.sync(source_id=sid, client=client)
        if resp is None or hasattr(resp, "detail"):
            fail += 1
        else:
            ok += 1
    return ok, fail


def _delete_legacy_sources(client: AuthenticatedClient, sources: list[dict]) -> tuple[int, int]:
    ok, fail = 0, 0
    for s in sources:
        sid = s.get("id", "")
        if not sid:
            fail += 1
            continue
        resp = nia_delete_source.sync(source_id=sid, client=client)
        if resp is None or hasattr(resp, "detail"):
            fail += 1
        else:
            ok += 1
    return ok, fail


def main() -> None:
    parser = argparse.ArgumentParser(description="Delete all Nia repositories/data sources once.")
    parser.add_argument("--yes", action="store_true", help="Actually delete. Without this, script is read-only.")
    parser.add_argument(
        "--show-files-limit",
        type=int,
        default=100,
        help="Maximum number of file paths to print per repository (default: 100).",
    )
    parser.add_argument(
        "--include-legacy-sources",
        action="store_true",
        help="Also delete entities from legacy /v2/sources API.",
    )
    args = parser.parse_args()

    # Load backend/.env
    load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

    import os
    api_key = os.environ.get("NIA_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("NIA_API_KEY is not set in environment/backend .env")

    client = _get_client(api_key)

    print("\n=== BEFORE DELETION ===")
    repos_before = _list_repositories(client)
    ds_before = _list_data_sources(client)
    legacy_before = _list_legacy_sources(client) if args.include_legacy_sources else []
    _print_section("Repositories", repos_before)
    _print_repo_files(client, repos_before, max(1, args.show_files_limit))
    _print_section("Data Sources (v2/data_sources)", ds_before)
    if args.include_legacy_sources:
        _print_section("Legacy Sources (v2/sources)", legacy_before)

    if not args.yes:
        print("\nDry run only. Re-run with --yes to perform deletion.")
        return

    print("\nDeleting...")
    repo_ok, repo_fail = _delete_repositories(client, repos_before)
    ds_ok, ds_fail = _delete_data_sources(client, ds_before)
    legacy_ok = legacy_fail = 0
    if args.include_legacy_sources:
        legacy_ok, legacy_fail = _delete_legacy_sources(client, legacy_before)

    print(
        f"Deleted repositories: {repo_ok} ok, {repo_fail} failed\n"
        f"Deleted data sources: {ds_ok} ok, {ds_fail} failed"
    )
    if args.include_legacy_sources:
        print(f"Deleted legacy sources: {legacy_ok} ok, {legacy_fail} failed")

    print("\n=== AFTER DELETION ===")
    repos_after = _list_repositories(client)
    ds_after = _list_data_sources(client)
    legacy_after = _list_legacy_sources(client) if args.include_legacy_sources else []
    _print_section("Repositories", repos_after)
    _print_section("Data Sources (v2/data_sources)", ds_after)
    if args.include_legacy_sources:
        _print_section("Legacy Sources (v2/sources)", legacy_after)


if __name__ == "__main__":
    main()
