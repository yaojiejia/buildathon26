"""
Documentation Agent — finds bug-relevant markdown docs in a repository.

Workflow:
  1. Collect markdown files (via Nia for GitHub repos, or local filesystem)
  2. Build compact previews for each markdown file
  3. Ask the LLM to rank which docs are most relevant to the issue

Output schema:
{
  "relevant_docs": [
    {
      "file_path": "README.md",
      "why_relevant": "Explains refund behavior and data model constraints",
      "key_sections": ["Refunds", "Order Item fields"]
    }
  ],
  "reasoning": "Why these docs are likely relevant",
  "confidence": "high | medium | low",
  "total_docs_scanned": 12
}
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

import requests

from llm import call_llm, get_default_model
from codebase_search_agent import (
    _extract_github_repo,
    _get_nia_client,
    clone_repo,
    IGNORE_DIRS,
)

from nia_py import AuthenticatedClient
from nia_py.api.v2_api import (
    get_repository_status_v2_v2_repositories_repository_id_get as nia_repo_status,
    index_repository_v2_v2_repositories_post as nia_index_repo,
    list_repositories_v2_v2_repositories_get as nia_list_repos,
    get_repository_content_v2_v2_repositories_repository_id_content_get as nia_get_content,
    get_repository_tree_v2_v2_repositories_repository_id_tree_get as nia_get_tree,
)
from nia_py.models import RepositoryRequest

from events import (
    EventEmitter,
    get_default_emitter,
    AGENT_DOC,
    EVENT_STATUS,
    EVENT_PROGRESS,
    EVENT_RESULT,
    EVENT_ERROR,
    EVENT_LOG,
    EVENT_SUMMARY,
)


A = AGENT_DOC
MAX_DOCS = 200
MAX_CANDIDATES = 20
MAX_PREVIEW_CHARS = 1600
MAX_SLACK_MESSAGES = 8
MAX_SLACK_CANDIDATES = 30
INDEX_POLL_INTERVAL = 5
INDEX_POLL_TIMEOUT = 300
NIA_BASE_URL = "https://apigcp.trynia.ai/v2"

DOC_RANK_SYSTEM_PROMPT = """\
You are a senior software engineer doing documentation triage for a bug.

You are given:
1) A bug report
2) Triage context
3) Candidate markdown documents with snippets

Pick only the most relevant documentation files that would help an engineer
understand or fix the bug.

Return ONLY valid JSON:
{
  "relevant_docs": [
    {
      "file_path": "docs/refunds.md",
      "why_relevant": "Short explanation",
      "key_sections": ["refund flow", "price_at_purchase"]
    }
  ],
  "reasoning": "Overall reasoning",
  "confidence": "high | medium | low"
}

Rules:
- Choose at most 8 files.
- Only use file paths from the candidate list.
- Keep explanations concrete and short.
"""

SLACK_RANK_SYSTEM_PROMPT = """\
You are a senior debugging engineer.

You are given:
1) A bug report
2) Candidate Slack messages (already retrieved from search)

Select the messages that are closest to the bug report and most useful for debugging.

Return ONLY valid JSON:
{
  "relevant_messages": [
    {
      "text": "message text",
      "why_relevant": "short reason",
      "channel": "#channel-name",
      "timestamp": "2026-01-01T00:00:00Z",
      "permalink": "https://..."
    }
  ]
}

Rules:
- Choose at most 8 messages.
- Prefer concrete bug evidence (errors, mismatched values, reproduction details, code paths).
- Keep reasons short and specific.
"""


def _to_plain(obj: Any) -> Any:
    """Convert SDK models into plain dict/list structures."""
    if obj is None:
        return None
    if isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, list):
        return [_to_plain(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _to_plain(v) for k, v in obj.items()}
    if hasattr(obj, "to_dict"):
        return _to_plain(obj.to_dict())
    if hasattr(obj, "additional_properties"):
        return _to_plain(dict(getattr(obj, "additional_properties")))
    return str(obj)


def _extract_md_paths(tree_data: Any) -> list[str]:
    """Recursively extract markdown paths from a repository tree payload."""
    found: set[str] = set()

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key in ("path", "file_path", "filepath", "name"):
                value = node.get(key)
                if isinstance(value, str) and value.lower().endswith(".md"):
                    found.add(value.lstrip("./"))
            for value in node.values():
                walk(value)
            return
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if isinstance(node, str) and node.lower().endswith(".md"):
            found.add(node.lstrip("./"))

    walk(tree_data)
    return sorted(found)


def _extract_text_content(payload: Any) -> str:
    """Extract text from Nia content payloads with shape/encoding variations."""
    data = _to_plain(payload)

    if isinstance(data, str):
        return data

    if isinstance(data, dict):
        for key in ("content", "text", "body"):
            value = data.get(key)
            if isinstance(value, str):
                if data.get("encoding") == "base64":
                    try:
                        return base64.b64decode(value).decode("utf-8", errors="ignore")
                    except Exception:
                        return value
                return value

        nested = data.get("data")
        if isinstance(nested, dict):
            for key in ("content", "text"):
                value = nested.get(key)
                if isinstance(value, str):
                    return value

    return json.dumps(data, default=str)


def _repo_matches(item_repo: str, target: str) -> bool:
    """Check if a Nia repository entry matches the target repo name."""
    if not item_repo or not target:
        return False

    norm_item = item_repo.rstrip("/").rstrip(".git")
    norm_target = target.rstrip("/").rstrip(".git")

    if norm_item == norm_target:
        return True
    if norm_item.endswith("/" + norm_target):
        return True
    if norm_target.endswith("/" + norm_item):
        return True

    for prefix in ("https://github.com/", "http://github.com/", "github.com/"):
        if norm_item.startswith(prefix):
            norm_item = norm_item[len(prefix):]
        if norm_target.startswith(prefix):
            norm_target = norm_target[len(prefix):]

    return norm_item == norm_target


def _nia_index_repo_for_docs(
    client: AuthenticatedClient,
    repo: str,
    force_reindex: bool,
    em: EventEmitter,
) -> str | None:
    """Index a repo on Nia for documentation retrieval."""
    em.emit(A, EVENT_PROGRESS, "nia_indexing",
            f"Checking Nia index for '{repo}'...")

    existing = nia_list_repos.sync(client=client, q=repo)
    if isinstance(existing, list):
        for item in existing:
            item_repo = getattr(item, "repository", None) or getattr(item, "name", "")
            item_id = getattr(item, "repository_id", None) or getattr(item, "id", None)
            item_status = getattr(item, "status", "")
            if not _repo_matches(item_repo, repo):
                continue
            if not force_reindex and item_status in ("ready", "completed", "indexed"):
                em.emit(A, EVENT_PROGRESS, "nia_indexing",
                        f"Using existing Nia index (id={item_id})")
                return item_id

    em.emit(A, EVENT_PROGRESS, "nia_indexing",
            "Starting Nia indexing for documentation scan...")
    result = nia_index_repo.sync(client=client, body=RepositoryRequest(repository=repo))
    if result is None or hasattr(result, "detail"):
        em.emit(A, EVENT_ERROR, "nia_indexing", f"Nia index request failed: {result}")
        return None

    repo_id = getattr(result, "project_id", None) or getattr(result, "repository_id", None)
    if not repo_id:
        em.emit(A, EVENT_ERROR, "nia_indexing", "Nia did not return repository ID")
        return None

    start = time.time()
    while time.time() - start < INDEX_POLL_TIMEOUT:
        status_resp = nia_repo_status.sync(repository_id=repo_id, client=client)
        status = getattr(status_resp, "status", None)
        if status in ("ready", "completed", "indexed"):
            em.emit(A, EVENT_PROGRESS, "nia_indexing", "Nia indexing complete")
            return repo_id
        if status in ("failed", "error"):
            em.emit(A, EVENT_ERROR, "nia_indexing", f"Nia indexing failed: {status_resp}")
            return None
        time.sleep(INDEX_POLL_INTERVAL)

    em.emit(A, EVENT_ERROR, "nia_indexing",
            f"Nia indexing timed out after {INDEX_POLL_TIMEOUT}s")
    return repo_id


def _parse_json_safe(raw_text: str, fallback: dict) -> dict:
    """Robust JSON extraction for LLM output."""
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        pass

    start = raw_text.find("{")
    end = raw_text.rfind("}") + 1
    if start < 0 or end <= start:
        return fallback


def _get_nia_api_key() -> str:
    """Get Nia API key from env."""
    return os.environ.get("NIA_API_KEY", "").strip()

    snippet = raw_text[start:end]
    try:
        return json.loads(snippet)
    except json.JSONDecodeError:
        pass

    import re as _re
    fixed = _re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', snippet)
    try:
        return json.loads(fixed)
    except json.JSONDecodeError:
        return fallback


def _collect_docs_local(repo_path: str, em: EventEmitter) -> list[dict]:
    """Collect markdown files from a local repository path."""
    repo = Path(repo_path)
    docs = []

    for fpath in sorted(repo.rglob("*.md")):
        if any(part in IGNORE_DIRS for part in fpath.parts):
            continue
        if not fpath.is_file():
            continue

        rel_path = str(fpath.relative_to(repo))
        try:
            text = fpath.read_text(errors="ignore")
        except Exception:
            text = ""

        docs.append({
            "file_path": rel_path,
            "content": text[:MAX_PREVIEW_CHARS],
        })
        if len(docs) >= MAX_DOCS:
            break

    em.emit(A, EVENT_PROGRESS, "collecting_docs",
            f"Collected {len(docs)} markdown files locally")
    return docs


def _score_overlap(text: str, keywords: list[str]) -> int:
    """Simple lexical overlap score."""
    hay = text.lower()
    return sum(1 for kw in keywords if kw and kw in hay)


def _nia_get_content_with_fallback(
    client: AuthenticatedClient,
    repo_id: str,
    path: str,
) -> Any:
    """Call Nia content endpoint across minor SDK argument naming differences."""
    attempts = [
        {"repository_id": repo_id, "path": path, "client": client},
        {"repository_id": repo_id, "file_path": path, "client": client},
        {"repository_id": repo_id, "filepath": path, "client": client},
    ]
    for kwargs in attempts:
        try:
            return nia_get_content.sync(**kwargs)
        except TypeError:
            continue
    return None


def _collect_docs_nia(
    client: AuthenticatedClient,
    repo_id: str,
    em: EventEmitter,
) -> list[dict]:
    """Collect markdown files from Nia repository tree + content endpoint."""
    em.emit(A, EVENT_PROGRESS, "collecting_docs",
            "Fetching repository tree from Nia...")

    try:
        tree_resp = nia_get_tree.sync(repository_id=repo_id, client=client)
    except Exception as e:
        em.emit(A, EVENT_ERROR, "collecting_docs", f"Nia tree fetch failed: {e}")
        return []

    md_paths = _extract_md_paths(_to_plain(tree_resp))
    em.emit(A, EVENT_PROGRESS, "collecting_docs",
            f"Nia returned {len(md_paths)} markdown paths")

    docs = []
    for path in md_paths[:MAX_DOCS]:
        raw = _nia_get_content_with_fallback(client, repo_id, path)
        if raw is None:
            em.emit(A, EVENT_LOG, "collecting_docs",
                    f"Skipping {path}: content fetch returned no payload")
            continue

        content = _extract_text_content(raw)[:MAX_PREVIEW_CHARS]
        docs.append({"file_path": path, "content": content})

    em.emit(A, EVENT_PROGRESS, "collecting_docs",
            f"Collected {len(docs)} markdown files from Nia")
    return docs


def _build_keywords(issue_title: str, issue_body: str, triage_result: dict | None) -> list[str]:
    """Build lightweight keywords for candidate pre-ranking."""
    text = f"{issue_title} {issue_body or ''}"
    if triage_result:
        text += " " + triage_result.get("likely_module", "")
        text += " " + triage_result.get("summary", "")
    raw = [w.strip(".,:;()[]{}\"'`").lower() for w in text.split()]
    return sorted({w for w in raw if len(w) >= 4})[:80]


def _pick_candidates(
    docs: list[dict],
    issue_title: str,
    issue_body: str,
    triage_result: dict | None,
) -> list[dict]:
    """Pre-rank docs by keyword overlap to keep LLM context bounded."""
    keywords = _build_keywords(issue_title, issue_body, triage_result)

    scored = []
    for doc in docs:
        hay = f"{doc['file_path']} {doc['content']}".lower()
        score = sum(1 for kw in keywords if kw and kw in hay)
        if "readme" in doc["file_path"].lower():
            score += 1
        if "/docs/" in f"/{doc['file_path'].lower()}/":
            score += 1
        scored.append((score, doc))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [doc for _, doc in scored[:MAX_CANDIDATES]]


def _select_relevant_docs(
    issue_title: str,
    issue_body: str,
    triage_result: dict | None,
    docs: list[dict],
    model: str,
    em: EventEmitter,
) -> dict:
    """Ask the LLM to select bug-relevant docs from candidate markdown files."""
    candidates = _pick_candidates(docs, issue_title, issue_body, triage_result)
    if not candidates:
        return {
            "relevant_docs": [],
            "reasoning": "No markdown candidates available.",
            "confidence": "low",
        }

    context = f"Issue Title: {issue_title}\nIssue Body: {issue_body or '(none)'}\n"
    if triage_result:
        context += f"Triage Severity: {triage_result.get('severity', 'unknown')}\n"
        context += f"Triage Module: {triage_result.get('likely_module', 'unknown')}\n"
        context += f"Triage Summary: {triage_result.get('summary', '')}\n"

    docs_blob = ""
    valid_paths: set[str] = set()
    for i, doc in enumerate(candidates, 1):
        path = doc["file_path"]
        valid_paths.add(path)
        docs_blob += (
            f"\n{'=' * 60}\n"
            f"Candidate #{i}\n"
            f"File: {path}\n"
            f"Snippet:\n{doc['content']}\n"
        )

    prompt = (
        f"{context}\n"
        f"Candidate markdown files:\n{docs_blob}\n\n"
        "Select the most relevant documentation files for this bug."
    )

    em.emit(A, EVENT_PROGRESS, "ranking_docs",
            f"Asking LLM ({model}) to rank {len(candidates)} documentation files...")

    try:
        raw = call_llm(DOC_RANK_SYSTEM_PROMPT, prompt, model)
    except Exception as e:
        em.emit(A, EVENT_ERROR, "ranking_docs", f"LLM error: {e}")
        return {
            "relevant_docs": [],
            "reasoning": "LLM ranking failed.",
            "confidence": "low",
        }

    parsed = _parse_json_safe(raw, {
        "relevant_docs": [],
        "reasoning": "Failed to parse LLM response.",
        "confidence": "low",
    })

    relevant = parsed.get("relevant_docs", [])
    if isinstance(relevant, list):
        filtered = []
        for item in relevant:
            if not isinstance(item, dict):
                continue
            path = item.get("file_path", "")
            if path in valid_paths:
                filtered.append(item)
        parsed["relevant_docs"] = filtered[:8]
    else:
        parsed["relevant_docs"] = []

    parsed.setdefault("reasoning", "")
    parsed.setdefault("confidence", "medium")
    return parsed


def _nia_universal_search(
    query: str,
    data_sources: list[str],
    repositories: list[str] | None = None,
) -> Any:
    """Call Nia universal-search directly via REST."""
    api_key = _get_nia_api_key()
    if not api_key:
        raise ValueError("NIA_API_KEY not set")

    body: dict[str, Any] = {
        "query": query,
        "data_sources": data_sources,
        "search_mode": "sources",
    }
    if repositories:
        body["repositories"] = repositories
        body["search_mode"] = "unified"

    resp = requests.post(
        f"{NIA_BASE_URL}/universal-search",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=body,
        timeout=45,
    )
    resp.raise_for_status()
    return resp.json()


def _extract_message_candidates(payload: Any) -> list[dict]:
    """Extract message-like items from heterogeneous universal-search payloads."""
    data = _to_plain(payload)
    out: list[dict] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
            return

        if not isinstance(node, dict):
            return

        text = ""
        for key in ("text", "message", "content", "snippet", "body", "answer"):
            value = node.get(key)
            if isinstance(value, str) and value.strip():
                text = value.strip()
                break

        metadata = node.get("metadata", {}) if isinstance(node.get("metadata"), dict) else {}
        source_blob = json.dumps(node, default=str).lower()
        looks_like_message = (
            bool(text) and (
                "slack" in source_blob
                or "channel" in source_blob
                or "thread" in source_blob
                or "permalink" in source_blob
                or "ts" in source_blob
            )
        )

        if looks_like_message:
            out.append({
                "text": text,
                "channel": (
                    node.get("channel")
                    or metadata.get("channel")
                    or metadata.get("channel_name")
                    or ""
                ),
                "timestamp": (
                    node.get("timestamp")
                    or metadata.get("timestamp")
                    or metadata.get("ts")
                    or ""
                ),
                "user": (
                    node.get("user")
                    or metadata.get("user")
                    or metadata.get("username")
                    or ""
                ),
                "permalink": (
                    node.get("permalink")
                    or metadata.get("permalink")
                    or metadata.get("url")
                    or ""
                ),
                "raw": node,
            })

        for value in node.values():
            walk(value)

    walk(data)

    dedup: dict[str, dict] = {}
    for msg in out:
        key = (msg.get("text", "") + "|" + msg.get("timestamp", "") + "|" + msg.get("channel", "")).strip()
        if key and key not in dedup:
            dedup[key] = msg
    return list(dedup.values())


def _rank_slack_messages(
    issue_title: str,
    issue_body: str,
    triage_result: dict | None,
    candidates: list[dict],
    model: str,
    em: EventEmitter,
) -> list[dict]:
    """Rank candidate Slack messages by bug relevance."""
    if not candidates:
        return []

    keywords = _build_keywords(issue_title, issue_body, triage_result)
    scored = sorted(
        candidates,
        key=lambda item: _score_overlap(
            f"{item.get('text', '')} {item.get('channel', '')}",
            keywords,
        ),
        reverse=True,
    )[:MAX_SLACK_CANDIDATES]

    msg_blob = ""
    for i, msg in enumerate(scored, 1):
        msg_blob += (
            f"\n{'=' * 60}\n"
            f"Message #{i}\n"
            f"channel: {msg.get('channel', '')}\n"
            f"timestamp: {msg.get('timestamp', '')}\n"
            f"user: {msg.get('user', '')}\n"
            f"permalink: {msg.get('permalink', '')}\n"
            f"text: {msg.get('text', '')}\n"
        )

    prompt = (
        f"Issue Title: {issue_title}\n"
        f"Issue Body: {issue_body or '(none)'}\n"
        f"{'Triage Summary: ' + triage_result.get('summary', '') if triage_result else ''}\n\n"
        f"Candidate Slack messages:\n{msg_blob}\n"
    )

    em.emit(A, EVENT_PROGRESS, "slack_search",
            f"Asking LLM ({model}) to select closest Slack messages...")

    try:
        raw = call_llm(SLACK_RANK_SYSTEM_PROMPT, prompt, model)
        parsed = _parse_json_safe(raw, {"relevant_messages": []})
        picked = parsed.get("relevant_messages", [])
    except Exception as e:
        em.emit(A, EVENT_ERROR, "slack_search", f"LLM ranking failed: {e}")
        picked = []

    if not isinstance(picked, list) or not picked:
        return scored[:MAX_SLACK_MESSAGES]

    # Map back to original candidates, preserving enriched metadata
    normalized = []
    for item in picked:
        if not isinstance(item, dict):
            continue
        text = item.get("text", "").strip()
        if not text:
            continue
        match = next((c for c in scored if c.get("text", "").strip() == text), None)
        base = dict(match) if match else {}
        base.update({
            "text": text,
            "why_relevant": item.get("why_relevant", ""),
            "channel": item.get("channel") or base.get("channel", ""),
            "timestamp": item.get("timestamp") or base.get("timestamp", ""),
            "permalink": item.get("permalink") or base.get("permalink", ""),
        })
        normalized.append(base)

    return normalized[:MAX_SLACK_MESSAGES] if normalized else scored[:MAX_SLACK_MESSAGES]


def _find_relevant_slack_messages(
    issue_title: str,
    issue_body: str,
    triage_result: dict | None,
    slack_source: str,
    model: str,
    em: EventEmitter,
) -> list[dict]:
    """Search a Nia-indexed Slack source and return closest bug messages."""
    queries = [issue_title]
    if triage_result and triage_result.get("summary"):
        queries.append(triage_result["summary"])
    if issue_body:
        queries.append(issue_body[:300])

    all_candidates: list[dict] = []
    for q in queries:
        try:
            result = _nia_universal_search(q, data_sources=[slack_source])
        except Exception as e:
            em.emit(A, EVENT_ERROR, "slack_search", f"Nia Slack search failed: {e}")
            continue
        candidates = _extract_message_candidates(result)
        all_candidates.extend(candidates)

    # de-dup
    seen = set()
    deduped = []
    for msg in all_candidates:
        key = (msg.get("text", "") + "|" + msg.get("timestamp", "") + "|" + msg.get("channel", "")).strip()
        if key and key not in seen:
            seen.add(key)
            deduped.append(msg)

    if not deduped:
        em.emit(A, EVENT_PROGRESS, "slack_search",
                "No Slack message candidates found in Nia results")
        return []

    em.emit(A, EVENT_PROGRESS, "slack_search",
            f"Found {len(deduped)} Slack candidates; ranking relevance...")
    return _rank_slack_messages(
        issue_title=issue_title,
        issue_body=issue_body,
        triage_result=triage_result,
        candidates=deduped,
        model=model,
        em=em,
    )


def analyze_docs(
    issue_title: str,
    issue_body: str,
    repo_url: str,
    repo_name: str = "",
    triage_result: dict | None = None,
    model: str | None = None,
    clone_dir: str | None = None,
    force_reindex: bool = False,
    slack_source: str | None = None,
    emitter: EventEmitter | None = None,
) -> dict:
    """Run the Documentation Agent."""
    em = emitter or get_default_emitter()
    model = model or get_default_model()

    em.emit(A, EVENT_STATUS, "starting",
            "═" * 58)
    em.emit(A, EVENT_STATUS, "starting",
            "  DOC AGENT — Starting documentation triage")
    em.emit(A, EVENT_STATUS, "starting",
            "═" * 58)

    em.emit(A, EVENT_STATUS, "collecting_docs",
            "STEP 1/2: Collecting markdown documentation")

    docs: list[dict] = []
    is_local = (clone_dir and Path(clone_dir).exists()) or Path(repo_url).is_dir()
    nia_client = _get_nia_client()
    github_repo = None if is_local else _extract_github_repo(repo_url, repo_name)

    if nia_client and github_repo:
        em.emit(A, EVENT_PROGRESS, "collecting_docs",
                f"Using Nia for markdown discovery (repo: {github_repo})")
        repo_id = _nia_index_repo_for_docs(nia_client, github_repo, force_reindex, em)
        if repo_id:
            docs = _collect_docs_nia(nia_client, repo_id, em)
        else:
            em.emit(A, EVENT_ERROR, "collecting_docs",
                    "Nia indexing failed for docs collection")
    else:
        tmp_dir = None
        if clone_dir and Path(clone_dir).exists():
            repo_path = clone_dir
        elif Path(repo_url).is_dir():
            repo_path = str(Path(repo_url))
        else:
            tmp_dir = tempfile.mkdtemp(prefix="bugpilot_docs_")
            repo_path = os.path.join(tmp_dir, "repo")
            em.emit(A, EVENT_PROGRESS, "collecting_docs",
                    f"Cloning {repo_url} for local markdown scan...")
            clone_repo(repo_url, repo_path)

        try:
            docs = _collect_docs_local(repo_path, em)
        finally:
            if tmp_dir and os.path.exists(tmp_dir):
                shutil.rmtree(tmp_dir, ignore_errors=True)

    if not docs:
        em.emit(A, EVENT_ERROR, "collecting_docs",
                "No markdown docs found for analysis")
        return {
            "relevant_docs": [],
            "reasoning": "No markdown files were discovered.",
            "confidence": "low",
            "total_docs_scanned": 0,
        }

    em.emit(A, EVENT_STATUS, "ranking_docs",
            "STEP 2/2: Ranking relevant documentation")

    result = _select_relevant_docs(
        issue_title=issue_title,
        issue_body=issue_body,
        triage_result=triage_result,
        docs=docs,
        model=model,
        em=em,
    )
    result["total_docs_scanned"] = len(docs)
    result.setdefault("relevant_messages", [])

    # Optional: search Slack messages via Nia source
    slack_source = slack_source or os.environ.get("NIA_SLACK_SOURCE", "").strip()
    if slack_source:
        em.emit(A, EVENT_STATUS, "slack_search",
                "STEP 3/3: Searching Slack messages via Nia")
        messages = _find_relevant_slack_messages(
            issue_title=issue_title,
            issue_body=issue_body,
            triage_result=triage_result,
            slack_source=slack_source,
            model=model,
            em=em,
        )
        result["relevant_messages"] = messages
    else:
        em.emit(A, EVENT_LOG, "slack_search",
                "Slack search disabled (set slack_source arg or NIA_SLACK_SOURCE env var)")

    em.emit(A, EVENT_RESULT, "complete",
            "Documentation triage complete", {
                "docs_scanned": len(docs),
                "relevant_docs": len(result.get("relevant_docs", [])),
                "relevant_messages": len(result.get("relevant_messages", [])),
                "confidence": result.get("confidence", "unknown"),
            })

    summary_lines = []
    for item in result.get("relevant_docs", [])[:5]:
        if isinstance(item, dict):
            summary_lines.append(
                f"{item.get('file_path', '?')} — {item.get('why_relevant', '')[:100]}"
            )

    em.emit(A, EVENT_SUMMARY, "summary",
            "Documentation Summary", {
                "docs_scanned": len(docs),
                "relevant_docs": len(result.get("relevant_docs", [])),
                "relevant_messages": len(result.get("relevant_messages", [])),
                "confidence": result.get("confidence", "unknown"),
                "findings": summary_lines,
                "reasoning": result.get("reasoning", "")[:200],
            })

    em.emit(A, EVENT_STATUS, "complete",
            "═" * 58)
    em.emit(A, EVENT_STATUS, "complete",
            "  DOC AGENT — Documentation triage complete")
    em.emit(A, EVENT_STATUS, "complete",
            "═" * 58)

    return result
