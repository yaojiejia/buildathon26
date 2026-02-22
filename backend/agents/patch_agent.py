"""
Patch Generation Agent.

Generates and applies code/test changes using prior agent outputs,
creates a feature branch, and prepares a draft PR description.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path

from llm import call_llm, get_default_model
from codebase_search_agent import clone_repo
from events import (
    AGENT_PATCH,
    EventEmitter,
    get_default_emitter,
    EVENT_ERROR,
    EVENT_LOG,
    EVENT_PROGRESS,
    EVENT_RESULT,
    EVENT_STATUS,
    EVENT_SUMMARY,
)
MAX_CONTEXT_FILES = 12
MAX_FILE_CHARS = 12000
MAX_PATCH_ATTEMPTS = 3
RAW_PREVIEW_CHARS = 500


PATCH_SYSTEM_PROMPT = """\
You are a senior software engineer generating a fix patch for a bug report.

Return ONLY valid JSON with this schema:
{
  "branch_name_hint": "short-kebab-name",
  "commit_title": "fix: short summary",
  "pr_title": "fix: short summary",
  "pr_body_markdown": "## Summary ...",
  "changes": [
    {
      "file_path": "relative/path.py",
      "action": "update" | "create",
      "content": "full file content after change",
      "summary": "what changed"
    }
  ],
  "tests": [
    {
      "file_path": "tests/test_x.py",
      "action": "update" | "create",
      "content": "full test file content",
      "summary": "test purpose"
    }
  ]
}

Rules:
- Generate practical, minimal-risk fixes.
- Include at least one unit test if test framework is available.
- The patch must change at least one existing source file (not docs-only).
- Prefer editing one of the provided suspect/context source files.
- Do not return empty changes/tests arrays.
- Do not touch .env, secret, credentials, key material, or token files.
- Use only relative repository paths.
- Keep PR body concise and actionable.
"""


def _run(cmd: list[str], cwd: str) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    except FileNotFoundError as e:
        # Normalize missing executable into a non-zero CompletedProcess
        return subprocess.CompletedProcess(
            args=cmd,
            returncode=127,
            stdout="",
            stderr=str(e),
        )


def _is_secret_path(path: str) -> bool:
    p = path.lower()
    blocked = [
        ".env",
        "secret",
        "secrets",
        "credential",
        "credentials",
        "token",
        "private_key",
        "id_rsa",
    ]
    return any(part in p for part in blocked)


def _safe_rel_path(path: str) -> bool:
    if not path or path.startswith("/"):
        return False
    if ".." in Path(path).parts:
        return False
    return True


def _normalize_repo_relative_path(path: str, repo_name: str) -> str:
    """Normalize Nia/LLM file paths to repository-relative form."""
    p = (path or "").strip().lstrip("./")
    rn = (repo_name or "").strip().strip("/")
    if not p:
        return p

    # Common Nia form: owner/repo/path/to/file.py
    if rn and p.startswith(rn + "/"):
        return p[len(rn) + 1 :]

    # Defensive fallback: strip first two segments if they look like owner/repo.
    parts = p.split("/")
    if len(parts) >= 3 and "." in parts[-1]:
        owner_like = parts[0] and not parts[0].startswith(".")
        repo_like = parts[1] and not parts[1].startswith(".")
        if owner_like and repo_like:
            return "/".join(parts[2:])

    return p


def _parse_json_safe(raw_text: str, fallback: dict) -> dict:
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        pass

    start = raw_text.find("{")
    end = raw_text.rfind("}") + 1
    if start < 0 or end <= start:
        return fallback

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


def _read_file(path: Path) -> str:
    try:
        return path.read_text(errors="ignore")
    except Exception:
        return ""


def _gather_context_files(repo_path: Path, search_result: dict, doc_result: dict, repo_name: str = "") -> list[dict]:
    files: list[str] = []
    for sf in search_result.get("suspect_files", [])[:10]:
        if isinstance(sf, dict) and sf.get("file_path"):
            files.append(_normalize_repo_relative_path(str(sf["file_path"]), repo_name))
    for d in doc_result.get("relevant_docs", [])[:6]:
        if isinstance(d, dict) and d.get("file_path", "").endswith(".md"):
            files.append(d["file_path"])

    dedup = []
    seen = set()
    for f in files:
        if f not in seen and _safe_rel_path(f):
            seen.add(f)
            dedup.append(f)

    contexts = []
    for rel in dedup[:MAX_CONTEXT_FILES]:
        p = repo_path / rel
        if not p.exists() or not p.is_file():
            continue
        content = _read_file(p)[:MAX_FILE_CHARS]
        contexts.append({"file_path": rel, "content": content})
    return contexts


def _issue_keywords(
    issue_title: str,
    issue_body: str,
    triage_result: dict | None,
    log_result: dict | None,
) -> list[str]:
    text = f"{issue_title} {issue_body or ''}"
    if triage_result:
        text += " " + str(triage_result.get("likely_module", ""))
        text += " " + str(triage_result.get("summary", ""))
    if log_result:
        for s in log_result.get("suspicious_logs", [])[:5]:
            if isinstance(s, dict):
                text += " " + str(s.get("message", ""))
    raw = [w.strip(".,:;()[]{}\"'`").lower() for w in text.split()]
    return sorted({w for w in raw if len(w) >= 4})[:80]


def _discover_candidate_files(
    repo_path: Path,
    issue_title: str,
    issue_body: str,
    triage_result: dict | None,
    log_result: dict | None,
) -> list[str]:
    """Heuristic file discovery when upstream suspect files are empty."""
    keywords = _issue_keywords(issue_title, issue_body, triage_result, log_result)
    ignore_dirs = {
        ".git", "node_modules", ".venv", "venv", "__pycache__", ".next", "dist", "build",
    }
    code_exts = {".py", ".js", ".ts", ".tsx", ".go", ".java", ".rb", ".php", ".cs"}

    scored: list[tuple[int, str]] = []
    for fpath in sorted(repo_path.rglob("*")):
        if not fpath.is_file():
            continue
        if fpath.suffix.lower() not in code_exts:
            continue
        if any(part in ignore_dirs for part in fpath.parts):
            continue
        rel = str(fpath.relative_to(repo_path))
        snippet = _read_file(fpath)[:6000].lower()
        rel_l = rel.lower()
        score = 0
        for kw in keywords:
            if kw in rel_l:
                score += 3
            if kw in snippet:
                score += 1
        if "test" in rel_l:
            score -= 1
        if score > 0:
            scored.append((score, rel))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [p for _, p in scored[:MAX_CONTEXT_FILES]]


def _candidate_models(primary_model: str) -> list[str]:
    """Use the pipeline-selected model for patch generation."""
    return [primary_model]


def _coerce_content_to_text(content: object) -> str | None:
    """Accept common LLM patch content shapes and normalize to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        if all(isinstance(x, str) for x in content):
            return "\n".join(content)
        return None
    if isinstance(content, dict):
        # Some models wrap file text under common keys.
        for key in ("text", "code", "content", "body"):
            value = content.get(key)
            if isinstance(value, str):
                return value
            if isinstance(value, list) and all(isinstance(x, str) for x in value):
                return "\n".join(value)
    return None


def _repo_issue_mismatch(search_result: dict, repo_path: str, repo_name: str = "") -> tuple[bool, str]:
    """Detect when investigation evidence says bug files do not exist in this repo."""
    reasoning = str(search_result.get("reasoning", "")).lower()
    suspect_files = search_result.get("suspect_files", [])

    missing_markers = (
        "not found in the provided codebase",
        "cannot find",
        "doesn't have access",
        "missing",
        "lacks the",
        "devoid of",
        "different codebase",
        "different repository",
    )
    if any(marker in reasoning for marker in missing_markers):
        return True, "Investigation indicates relevant bug files are missing in the target repository."

    # If all suspect files are synthetic placeholders (e.g. '**MISSING** ...')
    if suspect_files and isinstance(suspect_files, list):
        real_paths = []
        for sf in suspect_files:
            if not isinstance(sf, dict):
                continue
            p = _normalize_repo_relative_path(str(sf.get("file_path", "")).strip(), repo_name)
            if p and not p.startswith("**MISSING**") and _safe_rel_path(p):
                real_paths.append(p)
        if not real_paths:
            return True, "No concrete suspect file paths were found for this repository."
        missing_on_disk = [p for p in real_paths if not (Path(repo_path) / p).exists()]
        if missing_on_disk and len(missing_on_disk) == len(real_paths):
            return True, "Suspect files from investigation do not exist in the checked-out repository."

    return False, ""


def _ensure_repo(repo_url: str, clone_dir: str | None, repo_name: str, em: EventEmitter) -> tuple[str, bool]:
    """Resolve a writable local repository path; returns (path, is_temp)."""
    if clone_dir and Path(clone_dir).exists():
        return clone_dir, False
    if Path(repo_url).is_dir():
        return repo_url, False

    # Clone to a stable workspace for remote repos
    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", (repo_name or "repo"))
    workspace_root = Path(__file__).resolve().parent / "workspaces" / safe_name
    workspace_root.mkdir(parents=True, exist_ok=True)
    repo_dir = workspace_root / "repo"

    if not (repo_dir / ".git").exists():
        em.emit(AGENT_PATCH, EVENT_PROGRESS, "clone_repo", f"Cloning repo for patch work: {repo_url}")
        clone_repo(repo_url, str(repo_dir), depth=1)
    else:
        em.emit(AGENT_PATCH, EVENT_PROGRESS, "clone_repo",
                f"Using existing workspace repo: {repo_dir}")
        # Best-effort refresh from origin
        _run(["git", "fetch", "--all", "--prune"], cwd=str(repo_dir))

    return str(repo_dir), False


def _create_branch(repo_path: str, issue_title: str, hint: str, em: EventEmitter) -> str:
    slug_src = hint or issue_title
    slug = re.sub(r"[^a-z0-9]+", "-", slug_src.lower()).strip("-")[:40] or "bugfix"
    suffix = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    branch = f"bugpilot/{slug}-{suffix}"

    # Ensure git repo
    check = _run(["git", "rev-parse", "--is-inside-work-tree"], cwd=repo_path)
    if check.returncode != 0:
        raise RuntimeError("Target path is not a git repository")

    res = _run(["git", "checkout", "-b", branch], cwd=repo_path)
    if res.returncode != 0:
        raise RuntimeError(f"Failed to create branch: {res.stderr.strip() or res.stdout.strip()}")

    em.emit(AGENT_PATCH, EVENT_PROGRESS, "branch", f"Created branch: {branch}")
    return branch


def _write_changes(repo_path: str, items: list[dict], em: EventEmitter, repo_name: str = "") -> list[str]:
    changed_files: list[str] = []
    root = Path(repo_path)

    for item in items:
        if not isinstance(item, dict):
            continue
        file_path = _normalize_repo_relative_path(str(item.get("file_path", "")).strip(), repo_name)
        raw_content = item.get("content")
        action = str(item.get("action", "update")).strip().lower()

        if not _safe_rel_path(file_path):
            em.emit(AGENT_PATCH, EVENT_LOG, "apply_changes", f"Skipping unsafe path: {file_path}")
            continue
        if _is_secret_path(file_path):
            em.emit(AGENT_PATCH, EVENT_LOG, "apply_changes", f"Skipping secret-like path: {file_path}")
            continue
        if action not in ("update", "create"):
            continue
        content = _coerce_content_to_text(raw_content)
        if content is None:
            em.emit(
                AGENT_PATCH,
                EVENT_LOG,
                "apply_changes",
                f"Skipping {file_path}: unsupported content type={type(raw_content).__name__}",
            )
            continue

        out_path = root / file_path
        out_path.parent.mkdir(parents=True, exist_ok=True)
        existing = _read_file(out_path) if out_path.exists() else None
        if existing is not None and action == "update":
            old_len = len(existing)
            new_len = len(content)
            # Guardrail: reject likely partial-file outputs that would wipe large
            # portions of an existing file.
            if old_len > 0 and new_len > 0:
                shrink_ratio = new_len / old_len
                old_lines = existing.count("\n") + 1
                new_lines = content.count("\n") + 1
                line_ratio = new_lines / old_lines if old_lines else 1.0
                if shrink_ratio < 0.35 and line_ratio < 0.35:
                    em.emit(
                        AGENT_PATCH,
                        EVENT_ERROR,
                        "apply_changes",
                        (
                            f"Blocked suspicious truncating update for {file_path}: "
                            f"old_len={old_len}, new_len={new_len}, "
                            f"old_lines={old_lines}, new_lines={new_lines}"
                        ),
                    )
                    continue
        if existing == content:
            em.emit(AGENT_PATCH, EVENT_LOG, "apply_changes", f"No-op content for {file_path}; skipping")
            continue
        out_path.write_text(content)
        changed_files.append(file_path)

    return changed_files


def _build_prompt(
    issue_title: str,
    issue_body: str,
    triage_result: dict,
    search_result: dict,
    doc_result: dict,
    log_result: dict,
    context_files: list[dict],
) -> str:
    context_blob = ""
    for f in context_files:
        context_blob += (
            f"\n{'=' * 60}\n"
            f"File: {f['file_path']}\n"
            f"{'-' * 30}\n"
            f"{f['content']}\n"
        )

    return (
        f"Issue Title: {issue_title}\n"
        f"Issue Body: {issue_body or '(none)'}\n\n"
        f"Triage:\n{json.dumps(triage_result or {}, indent=2)}\n\n"
        f"Investigation:\n{json.dumps(search_result or {}, indent=2)}\n\n"
        f"Documentation:\n{json.dumps(doc_result or {}, indent=2)}\n\n"
        f"Log Analysis:\n{json.dumps(log_result or {}, indent=2)}\n\n"
        f"Relevant repository files:\n{context_blob}\n"
    )


def _git_diff(repo_path: str) -> str:
    res = _run(["git", "diff", "--", "."], cwd=repo_path)
    return res.stdout if res.returncode == 0 else ""


def _git_status(repo_path: str) -> str:
    res = _run(["git", "status", "--porcelain"], cwd=repo_path)
    return res.stdout if res.returncode == 0 else ""


def _commit_changes(repo_path: str, title: str, em: EventEmitter) -> str | None:
    add = _run(["git", "add", "-A"], cwd=repo_path)
    if add.returncode != 0:
        em.emit(AGENT_PATCH, EVENT_ERROR, "commit", f"git add failed: {add.stderr.strip()}")
        return None

    status = _run(["git", "status", "--porcelain"], cwd=repo_path)
    if status.returncode != 0 or not status.stdout.strip():
        return None

    commit = _run(["git", "commit", "-m", title or "fix: patch from bugpilot agent"], cwd=repo_path)
    if commit.returncode != 0:
        em.emit(AGENT_PATCH, EVENT_ERROR, "commit", f"git commit failed: {commit.stderr.strip()}")
        return None

    sha = _run(["git", "rev-parse", "HEAD"], cwd=repo_path)
    if sha.returncode == 0:
        return sha.stdout.strip()
    return None


def _create_draft_pr(repo_path: str, title: str, body: str, branch: str, em: EventEmitter) -> dict:
    has_gh = _run(["gh", "--version"], cwd=repo_path)
    if has_gh.returncode != 0:
        return {"status": "skipped", "reason": "gh CLI not installed"}

    base = _default_branch(repo_path)
    head_ref = f"{branch}"
    cmd = ["gh", "pr", "create", "--draft", "--title", title, "--body", body, "--base", base, "--head", head_ref]
    res = _run(cmd, cwd=repo_path)
    if res.returncode == 0:
        url = (res.stdout or "").strip().splitlines()[-1] if (res.stdout or "").strip() else ""
        em.emit(AGENT_PATCH, EVENT_PROGRESS, "draft_pr", f"Draft PR created: {url or '(created)'}")
        return {"status": "created", "url": url}

    err = (res.stderr or res.stdout or "").strip()
    em.emit(AGENT_PATCH, EVENT_ERROR, "draft_pr", f"Draft PR creation failed: {err[:300]}")
    return {"status": "failed", "error": err[:1000]}


def _default_branch(repo_path: str) -> str:
    """Detect default branch from origin/HEAD; fallback to main."""
    ref = _run(["git", "symbolic-ref", "refs/remotes/origin/HEAD"], cwd=repo_path)
    if ref.returncode == 0:
        value = ref.stdout.strip()
        if value.startswith("refs/remotes/origin/"):
            return value.split("refs/remotes/origin/", 1)[1]
    return "main"


def _push_branch(repo_path: str, branch: str, em: EventEmitter) -> dict:
    """Push branch to origin so PR can be opened."""
    push = _run(["git", "push", "-u", "origin", branch], cwd=repo_path)
    if push.returncode == 0:
        em.emit(AGENT_PATCH, EVENT_PROGRESS, "push_branch", f"Pushed branch: {branch}")
        return {"status": "pushed"}
    err = (push.stderr or push.stdout or "").strip()
    em.emit(AGENT_PATCH, EVENT_ERROR, "push_branch", f"Failed to push branch: {err[:300]}")
    return {"status": "failed", "error": err[:1000]}


def generate_patch(
    issue_title: str,
    issue_body: str,
    repo_url: str,
    repo_name: str = "",
    triage_result: dict | None = None,
    search_result: dict | None = None,
    doc_result: dict | None = None,
    log_result: dict | None = None,
    model: str | None = None,
    clone_dir: str | None = None,
    emitter: EventEmitter | None = None,
) -> dict:
    em = emitter or get_default_emitter()
    model = model or get_default_model()

    em.emit(AGENT_PATCH, EVENT_STATUS, "starting", "═" * 58)
    em.emit(AGENT_PATCH, EVENT_STATUS, "starting", "  PATCH AGENT — Generating fix patch")
    em.emit(AGENT_PATCH, EVENT_STATUS, "starting", "═" * 58)

    triage_result = triage_result or {}
    search_result = search_result or {}
    doc_result = doc_result or {}
    log_result = log_result or {}

    try:
        repo_path, is_temp = _ensure_repo(repo_url, clone_dir, repo_name, em)
    except Exception as e:
        em.emit(AGENT_PATCH, EVENT_ERROR, "clone_repo", f"Failed to prepare repo: {e}")
        return {
            "status": "failed",
            "error": f"repo_prepare_failed: {e}",
            "draft_pr": {"status": "not_attempted"},
        }

    em.emit(AGENT_PATCH, EVENT_PROGRESS, "context", "Building patch context from prior agents...")
    context_files = _gather_context_files(Path(repo_path), search_result, doc_result, repo_name)
    mismatch, mismatch_reason = _repo_issue_mismatch(search_result, repo_path, repo_name)
    if mismatch:
        em.emit(AGENT_PATCH, EVENT_ERROR, "context", f"Repo/issue mismatch: {mismatch_reason}")
        return {
            "status": "failed",
            "error": "repo_issue_mismatch",
            "reason": mismatch_reason,
            "repo_path": repo_path,
            "is_temp_repo": is_temp,
            "draft_pr": {"status": "not_attempted"},
        }

    discovered = _discover_candidate_files(
        repo_path=Path(repo_path),
        issue_title=issue_title,
        issue_body=issue_body,
        triage_result=triage_result,
        log_result=log_result,
    )
    if discovered:
        existing_paths = {c["file_path"] for c in context_files}
        for rel in discovered:
            if rel in existing_paths:
                continue
            p = Path(repo_path) / rel
            if p.exists() and p.is_file():
                context_files.append({"file_path": rel, "content": _read_file(p)[:MAX_FILE_CHARS]})
                if len(context_files) >= MAX_CONTEXT_FILES:
                    break

    prompt = _build_prompt(
        issue_title=issue_title,
        issue_body=issue_body,
        triage_result=triage_result,
        search_result=search_result,
        doc_result=doc_result,
        log_result=log_result,
        context_files=context_files,
    )
    editable_sources = [c["file_path"] for c in context_files if c["file_path"].endswith((".py", ".ts", ".js", ".go", ".java", ".rb", ".php", ".cs"))]
    if editable_sources:
        prompt += (
            "\nYou MUST modify at least one of these existing source files:\n- "
            + "\n- ".join(editable_sources[:8])
            + "\n"
        )

    models = _candidate_models(model)
    em.emit(AGENT_PATCH, EVENT_PROGRESS, "llm",
            f"Patch attempts will use models: {', '.join(models)}")
    attempted_models: list[str] = []
    attempt_debug: list[dict] = []
    used_model = None
    patch = None

    changed: list[str] = []
    diff = ""
    for candidate_model in models:
        attempted_models.append(candidate_model)
        em.emit(AGENT_PATCH, EVENT_PROGRESS, "llm",
                f"Asking LLM ({candidate_model}) for code/test patch...")
        try:
            raw = call_llm(PATCH_SYSTEM_PROMPT, prompt, candidate_model)
        except Exception as e:
            em.emit(AGENT_PATCH, EVENT_ERROR, "llm",
                    f"LLM error ({candidate_model}): {e}")
            attempt_debug.append({
                "model": candidate_model,
                "error": str(e),
            })
            continue

        raw_preview = raw[:RAW_PREVIEW_CHARS].replace("\n", "\\n")
        em.emit(AGENT_PATCH, EVENT_LOG, "llm",
                f"{candidate_model} raw preview: {raw_preview}")

        candidate_patch = _parse_json_safe(raw, {
            "branch_name_hint": "",
            "commit_title": "fix: patch generated by bugpilot",
            "pr_title": "fix: bug patch",
            "pr_body_markdown": "Automated patch draft generated by BugPilot.",
            "changes": [],
            "tests": [],
        })
        em.emit(
            AGENT_PATCH,
            EVENT_LOG,
            "llm",
            f"{candidate_model} parsed patch: changes={len(candidate_patch.get('changes', []))}, "
            f"tests={len(candidate_patch.get('tests', []))}, keys={sorted(candidate_patch.keys())}",
        )

        changes = candidate_patch.get("changes", [])
        tests = candidate_patch.get("tests", [])

        # Debug candidate paths before writing.
        for item in (changes + tests)[:20]:
            if not isinstance(item, dict):
                continue
            raw_path = str(item.get("file_path", ""))
            norm_path = _normalize_repo_relative_path(raw_path, repo_name)
            action = str(item.get("action", "update")).lower()
            content = item.get("content")
            exists = (Path(repo_path) / norm_path).exists() if norm_path else False
            em.emit(
                AGENT_PATCH,
                EVENT_LOG,
                "llm",
                f"candidate file: raw='{raw_path}' norm='{norm_path}' action={action} "
                f"exists={exists} content_len={len(content) if isinstance(content, str) else -1}",
            )

        changed = _write_changes(repo_path, changes, em, repo_name)
        changed += _write_changes(repo_path, tests, em, repo_name)
        changed = sorted(set(changed))

        diff = _git_diff(repo_path)
        status_now = _git_status(repo_path)
        em.emit(
            AGENT_PATCH,
            EVENT_LOG,
            "llm",
            f"{candidate_model} write result: changed_files={changed}, diff_len={len(diff)}, "
            f"status_lines={len([ln for ln in status_now.splitlines() if ln.strip()])}",
        )
        attempt_debug.append({
            "model": candidate_model,
            "parsed_changes": len(changes),
            "parsed_tests": len(tests),
            "written_files": changed,
            "diff_len": len(diff),
            "status": status_now.splitlines()[:10],
        })
        if changed and diff.strip():
            patch = candidate_patch
            used_model = candidate_model
            em.emit(AGENT_PATCH, EVENT_PROGRESS, "llm",
                    f"Model {candidate_model} produced a non-empty patch")
            break

        em.emit(AGENT_PATCH, EVENT_LOG, "llm",
                f"Model {candidate_model} produced no meaningful diff; trying next model")

    if not patch or not changed or not diff.strip():
        em.emit(AGENT_PATCH, EVENT_ERROR, "apply_changes", "No patch changes were generated")
        return {
            "status": "failed",
            "error": "no_changes_generated",
            "repo_path": repo_path,
            "is_temp_repo": is_temp,
            "draft_pr": {"status": "not_attempted"},
            "changed_files": changed,
            "attempted_models": attempted_models,
            "attempt_debug": attempt_debug,
        }

    try:
        branch = _create_branch(
            repo_path=repo_path,
            issue_title=issue_title,
            hint=str(patch.get("branch_name_hint", "")),
            em=em,
        )
    except Exception as e:
        em.emit(AGENT_PATCH, EVENT_ERROR, "branch", str(e))
        return {
            "status": "failed",
            "error": f"branch_failed: {e}",
            "repo_path": repo_path,
            "is_temp_repo": is_temp,
            "draft_pr": {"status": "not_attempted"},
            "changed_files": changed,
            "attempted_models": attempted_models,
            "attempt_debug": attempt_debug,
        }

    commit_title = str(patch.get("commit_title", "fix: patch generated by bugpilot")).strip()
    commit_sha = _commit_changes(repo_path, commit_title, em)

    pr_title = str(patch.get("pr_title", commit_title)).strip() or commit_title
    pr_body = str(
        patch.get(
            "pr_body_markdown",
            "## Summary\n- Automated patch generated by BugPilot\n",
        )
    )
    push_result = _push_branch(repo_path, branch, em)
    if push_result.get("status") == "pushed":
        pr_result = _create_draft_pr(repo_path, pr_title, pr_body, branch, em)
    else:
        pr_result = {"status": "failed", "error": "branch_not_pushed"}

    overall_status = "ok" if pr_result.get("status") == "created" else "partial"

    out = {
        "status": overall_status,
        "repo_path": repo_path,
        "is_temp_repo": is_temp,
        "branch": branch,
        "model_used": used_model or model,
        "attempted_models": attempted_models,
        "attempt_debug": attempt_debug,
        "commit_sha": commit_sha,
        "changed_files": changed,
        "diff": diff,
        "pr_title": pr_title,
        "pr_body_markdown": pr_body,
        "draft_pr": pr_result,
        "push_branch": push_result,
    }

    em.emit(
        AGENT_PATCH,
        EVENT_RESULT,
        "complete",
        "Patch generation complete",
        {
            "changed_files": len(changed),
            "branch": branch,
            "commit_sha": commit_sha or "none",
            "draft_pr_status": pr_result.get("status", "unknown"),
        },
    )
    em.emit(
        AGENT_PATCH,
        EVENT_SUMMARY,
        "summary",
        "Patch Generation Summary",
        {
            "branch": branch,
            "changed_files": len(changed),
            "draft_pr_status": pr_result.get("status", "unknown"),
            "findings": changed[:8],
        },
    )
    em.emit(AGENT_PATCH, EVENT_STATUS, "complete", "═" * 58)
    em.emit(AGENT_PATCH, EVENT_STATUS, "complete", "  PATCH AGENT — Complete")
    em.emit(AGENT_PATCH, EVENT_STATUS, "complete", "═" * 58)
    return out
