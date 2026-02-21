"""
Codebase Search Agent — Claude + Nia collaborative investigation.

Workflow:
  1. CLAUDE: Generate 3-5 targeted investigation questions from the bug report
  2. NIA:    For each question, query the indexed codebase for concrete evidence
  3. CLAUDE: Analyze all collected evidence and produce a structured report

For local directories (no Nia), the same workflow applies but questions are
answered via local file search + Claude instead of Nia.

Output schema:
{
  "suspect_files": [
    {
      "file_path": "src/auth/login.py",
      "why_relevant": "Contains the login handler that crashes on mobile",
      "lines_referenced": [42, 43, 44, 78],
      "snippet": "def login(request): ..."
    }
  ],
  "reasoning": "Based on the issue description about login crashes...",
  "confidence": "high | medium | low",
  "questions_asked": ["What does the login handler do?", ...],
  "evidence_collected": [{"question": "...", "answer": "...", "sources": [...]}, ...]
}
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import anthropic

# ── Nia SDK imports ──────────────────────────────────────────────
from nia_py import AuthenticatedClient
from nia_py.api.v2_api import (
    index_repository_v2_v2_repositories_post as nia_index_repo,
    list_repositories_v2_v2_repositories_get as nia_list_repos,
    get_repository_status_v2_v2_repositories_repository_id_get as nia_repo_status,
    query_repositories_v2_v2_query_post as nia_query,
    grep_repository_v2_v2_repositories_repository_id_grep_post as nia_grep,
    get_repository_content_v2_v2_repositories_repository_id_content_get as nia_get_content,
    get_repository_tree_v2_v2_repositories_repository_id_tree_get as nia_get_tree,
)
from nia_py.models import (
    RepositoryRequest,
    QueryRequest,
    QueryRequestMessagesItem,
    CodeGrepRequest,
)

# ── Event system ─────────────────────────────────────────────────
from events import (
    EventEmitter,
    get_default_emitter,
    AGENT_CODEBASE_SEARCH,
    EVENT_STATUS,
    EVENT_PROGRESS,
    EVENT_RESULT,
    EVENT_ERROR,
    EVENT_LOG,
)

# ── Constants ────────────────────────────────────────────────────

A = AGENT_CODEBASE_SEARCH  # shorthand for event emission

NIA_BASE_URL = "https://apigcp.trynia.ai/v2"
MAX_SUSPECT_FILES = 10
MAX_QUESTIONS = 5
INDEX_POLL_INTERVAL = 5   # seconds between status checks
INDEX_POLL_TIMEOUT = 120  # max seconds to wait for indexing

# Extensions for local fallback
CODE_EXTENSIONS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java",
    ".rb", ".php", ".c", ".cpp", ".h", ".hpp", ".cs", ".swift",
    ".kt", ".scala", ".vue", ".svelte", ".html", ".css", ".scss",
    ".sql", ".sh", ".bash", ".yaml", ".yml", ".toml", ".json",
    ".md", ".txt", ".env", ".dockerfile", ".tf",
}

IGNORE_DIRS = {
    ".git", "node_modules", "__pycache__", ".next", "dist", "build",
    "venv", ".venv", "env", ".env", ".tox", "target", "vendor",
    ".idea", ".vscode", "coverage", ".cache",
}

PREVIEW_LINES = 10
MAX_INDEX_FILES = 500


# ═══════════════════════════════════════════════════════════════════
#  CLAUDE PROMPTS
# ═══════════════════════════════════════════════════════════════════

QUESTION_GEN_SYSTEM_PROMPT = """\
You are a senior debugging engineer. Given a bug report and triage context,
generate 3-5 highly targeted investigation questions that would help locate
the root cause in the codebase.

Each question should be:
- Specific enough to search a codebase for concrete answers
- Focused on a different angle (e.g. data flow, error handling, config, auth)
- Phrased as a question about the code, not the bug itself
- Ask the relative line numbers to the file that contains bug

Also generate 1-2 grep patterns (regex) that would match relevant code.

Return ONLY a valid JSON object:
{
  "questions": [
    "How is the user password validated in the login endpoint? Where is that in server.py?",
    "What SQL query construction method is used in the search functionality?",
    "Where is the database connection configured and are queries parameterized?"
  ],
  "grep_patterns": [
    "f['\"]SELECT.*WHERE",
    "execute\\(.*f['\"]"
  ]
}
"""

REPORT_SYSTEM_PROMPT = """\
You are a senior debugging engineer writing an investigation report.

You have been given:
1. A bug report
2. Triage context (severity, likely module)
3. Evidence collected by querying the codebase — each piece of evidence is
   an answer to a targeted investigation question, with source references.

Based on ALL the collected evidence, produce a precise investigation report.

Return ONLY a valid JSON object:
{
  "suspect_files": [
    {
      "file_path": "path/to/file.py",
      "why_relevant": "Explanation of why this file is connected to the bug",
      "lines_referenced": [42, 43, 78],
      "snippet": "The specific code snippet (max 10 lines) that is most relevant"
    }
  ],
  "reasoning": "Overall reasoning about the root cause based on the evidence",
  "confidence": "high | medium | low"
}

Rules:
- Be precise about line numbers — only cite lines you actually saw in the evidence.
- Do NOT hallucinate files or code that was not in the evidence.
- Rank suspect files by relevance (most likely root cause first).
- Include at most 10 suspect files.
"""

IDENTIFY_SYSTEM_PROMPT = """\
You are a senior debugging engineer. Given a bug report and a file index of a
codebase, identify the most likely suspect files that are relevant to the bug.

Return ONLY a valid JSON object:
{
  "suspect_files": ["path/to/file1.py", "path/to/file2.ts"],
  "reasoning": "Brief explanation of why these files are suspects"
}

Pick at most 10 files. Rank by most likely first. Only include files that
actually appear in the provided index.
"""


# ═══════════════════════════════════════════════════════════════════
#  CLAUDE HELPERS
# ═══════════════════════════════════════════════════════════════════

def _call_claude(system: str, user_msg: str, model: str) -> str:
    """Call Claude and return the text response."""
    client = anthropic.Anthropic()
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=system,
        messages=[{"role": "user", "content": user_msg}],
    )
    raw = response.content[0].text.strip()
    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return raw


def _parse_json_safe(raw: str, fallback: dict | None = None, em: EventEmitter | None = None) -> dict:
    """Parse JSON from Claude's response with fallback."""
    em = em or get_default_emitter()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        em.emit(A, EVENT_LOG, "json_parse", f"Direct parse failed: {e}")
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                result = json.loads(raw[start:end])
                em.emit(A, EVENT_LOG, "json_parse", f"Extracted JSON from position {start}:{end}")
                return result
            except json.JSONDecodeError as e2:
                em.emit(A, EVENT_LOG, "json_parse", f"Extraction also failed: {e2}")
        else:
            em.emit(A, EVENT_LOG, "json_parse", f"No JSON object found in response (len={len(raw)})")
        return fallback or {}


def _build_issue_context(
    issue_title: str,
    issue_body: str,
    repo_name: str,
    triage_result: dict | None,
) -> str:
    """Build the issue context string for Claude prompts."""
    context = f"Issue Title: {issue_title}\n"
    context += f"Issue Body: {issue_body or '(none)'}\n"
    if repo_name:
        context += f"Repository: {repo_name}\n"
    if triage_result:
        context += f"Triage Severity: {triage_result.get('severity', 'unknown')}\n"
        context += f"Triage Module: {triage_result.get('likely_module', 'unknown')}\n"
        context += f"Triage Summary: {triage_result.get('summary', '')}\n"
    return context


# ═══════════════════════════════════════════════════════════════════
#  STEP 1: CLAUDE GENERATES INVESTIGATION QUESTIONS
# ═══════════════════════════════════════════════════════════════════

def _generate_questions(
    issue_title: str,
    issue_body: str,
    triage_result: dict | None,
    model: str,
    em: EventEmitter | None = None,
) -> tuple[list[str], list[str]]:
    """Ask Claude to generate targeted investigation questions + grep patterns."""
    em = em or get_default_emitter()

    em.emit(A, EVENT_PROGRESS, "generating_questions",
            "Asking Claude to generate investigation questions...")

    context = _build_issue_context(issue_title, issue_body, "", triage_result)
    em.emit(A, EVENT_LOG, "generating_questions",
            f"Context built ({len(context)} chars)")

    try:
        raw = _call_claude(QUESTION_GEN_SYSTEM_PROMPT, context, model)
    except Exception as e:
        em.emit(A, EVENT_ERROR, "generating_questions", f"Claude API error: {e}")
        return [], []

    em.emit(A, EVENT_LOG, "generating_questions",
            f"Claude responded ({len(raw)} chars)")

    # Show full response for debugging
    for line in raw.splitlines():
        em.emit(A, EVENT_LOG, "generating_questions", f"  | {line}")

    parsed = _parse_json_safe(raw, {"questions": [], "grep_patterns": []}, em)
    if not parsed.get("questions"):
        em.emit(A, EVENT_ERROR, "generating_questions",
                f"No questions in parsed result. Keys: {list(parsed.keys())}")

    questions = parsed.get("questions", [])[:MAX_QUESTIONS]
    grep_patterns = parsed.get("grep_patterns", [])

    em.emit(A, EVENT_PROGRESS, "generating_questions",
            f"Generated {len(questions)} questions:")
    for i, q in enumerate(questions, 1):
        em.emit(A, EVENT_PROGRESS, "generating_questions", f"  Q{i}: {q}")

    if grep_patterns:
        em.emit(A, EVENT_PROGRESS, "generating_questions",
                f"Generated {len(grep_patterns)} grep patterns:")
        for p in grep_patterns:
            em.emit(A, EVENT_LOG, "generating_questions", f"  Pattern: {p}")

    return questions, grep_patterns


# ═══════════════════════════════════════════════════════════════════
#  NIA CLIENT + INDEXING
# ═══════════════════════════════════════════════════════════════════

def _get_nia_client() -> AuthenticatedClient | None:
    """Create a Nia AuthenticatedClient if NIA_API_KEY is set."""
    api_key = os.environ.get("NIA_API_KEY", "").strip()
    if not api_key or api_key == "your-nia-api-key-here":
        return None
    return AuthenticatedClient(
        base_url=NIA_BASE_URL,
        token=api_key,
    )


def _nia_index_repo(
    client: AuthenticatedClient,
    repo: str,
    branch: str | None = None,
    em: EventEmitter | None = None,
) -> str | None:
    """Index a GitHub repository on Nia. Returns the repository_id or None."""
    em = em or get_default_emitter()

    em.emit(A, EVENT_PROGRESS, "nia_indexing",
            f"Checking if '{repo}' is already indexed...")

    existing = nia_list_repos.sync(client=client, q=repo)
    if isinstance(existing, list):
        for item in existing:
            if item.repository == repo and item.status in (
                "ready", "completed", "indexed",
            ):
                em.emit(A, EVENT_PROGRESS, "nia_indexing",
                        f"Repository already indexed (id={item.repository_id})")
                return item.repository_id

    em.emit(A, EVENT_PROGRESS, "nia_indexing",
            f"Sending indexing request for '{repo}'...")
    body = RepositoryRequest(repository=repo)
    if branch:
        body.branch = branch

    result = nia_index_repo.sync(client=client, body=body)

    if result is None or hasattr(result, "detail"):
        em.emit(A, EVENT_ERROR, "nia_indexing", f"Indexing request failed: {result}")
        return None

    repo_id = getattr(result, "project_id", None) or getattr(
        result, "repository_id", None
    )
    if not repo_id:
        em.emit(A, EVENT_ERROR, "nia_indexing", "No repository ID returned from indexing")
        return None

    em.emit(A, EVENT_PROGRESS, "nia_indexing",
            f"Indexing started (id={repo_id}). Polling for completion...")
    start_time = time.time()
    while time.time() - start_time < INDEX_POLL_TIMEOUT:
        status_resp = nia_repo_status.sync(repository_id=repo_id, client=client)
        if status_resp and hasattr(status_resp, "status"):
            status = status_resp.status
            elapsed = int(time.time() - start_time)
            if status in ("ready", "completed", "indexed"):
                em.emit(A, EVENT_PROGRESS, "nia_indexing",
                        f"Indexing complete! ({elapsed}s)")
                return repo_id
            elif status in ("failed", "error"):
                err = getattr(status_resp, "error", "unknown")
                em.emit(A, EVENT_ERROR, "nia_indexing",
                        f"Indexing FAILED after {elapsed}s: {err}")
                return None
            else:
                em.emit(A, EVENT_LOG, "nia_indexing",
                        f"  ... status={status} ({elapsed}s elapsed)")
        time.sleep(INDEX_POLL_INTERVAL)

    em.emit(A, EVENT_ERROR, "nia_indexing",
            f"Indexing timed out after {INDEX_POLL_TIMEOUT}s, proceeding anyway")
    return repo_id


# ═══════════════════════════════════════════════════════════════════
#  STEP 2a: QUERY NIA FOR EVIDENCE
# ═══════════════════════════════════════════════════════════════════

def _nia_query_question(
    client: AuthenticatedClient,
    repo_id: str,
    question: str,
    question_idx: int,
    em: EventEmitter | None = None,
) -> dict:
    """Send a single question to Nia and return the evidence."""
    em = em or get_default_emitter()

    em.emit(A, EVENT_PROGRESS, "querying_nia",
            f"Querying Nia Q{question_idx}: \"{question}\"")

    body = QueryRequest(
        messages=[QueryRequestMessagesItem.from_dict({
            "role": "user",
            "content": question,
        })],
        repositories=[repo_id],
        include_sources=True,
        skip_llm=False,
    )

    result = nia_query.sync(client=client, body=body)

    if result is None:
        em.emit(A, EVENT_LOG, "querying_nia",
                f"Q{question_idx}: No response from Nia")
        return {"question": question, "answer": "(no response)", "sources": []}

    # Normalize the result into a plain dict
    if isinstance(result, dict):
        data = result
    elif hasattr(result, "to_dict"):
        data = result.to_dict()
    elif hasattr(result, "additional_properties"):
        data = dict(result.additional_properties)
    else:
        data = {"answer": str(result), "sources": []}

    # Extract the answer — could be a string or a nested dict
    raw_answer = data.get("answer", data.get("response", data.get("content", data)))
    if isinstance(raw_answer, dict):
        answer = raw_answer.get("content", raw_answer.get("text", json.dumps(raw_answer, default=str)))
    elif isinstance(raw_answer, str):
        answer = raw_answer
    else:
        answer = str(raw_answer)

    # Extract sources
    raw_sources = data.get("sources", data.get("references", data.get("chunks", [])))
    if isinstance(raw_sources, list):
        sources = []
        for s in raw_sources:
            if hasattr(s, "to_dict"):
                sources.append(s.to_dict())
            elif isinstance(s, dict):
                sources.append(s)
            else:
                sources.append({"content": str(s)})
    elif hasattr(raw_sources, "to_dict"):
        sources = [raw_sources.to_dict()]
    else:
        sources = []

    answer_preview = answer[:200] + "..." if len(answer) > 200 else answer
    em.emit(A, EVENT_LOG, "querying_nia",
            f"Q{question_idx} answer: {answer_preview}")
    em.emit(A, EVENT_LOG, "querying_nia",
            f"Q{question_idx} sources: {len(sources)} references")

    return {
        "question": question,
        "answer": answer,
        "sources": sources,
    }


def _nia_grep_pattern(
    client: AuthenticatedClient,
    repo_id: str,
    pattern: str,
    em: EventEmitter | None = None,
) -> dict:
    """Grep the repo for a pattern and return results as evidence."""
    em = em or get_default_emitter()

    em.emit(A, EVENT_LOG, "querying_nia", f"Grep: \"{pattern}\"")

    body = CodeGrepRequest(
        pattern=pattern,
        context_lines=3,
        include_line_numbers=True,
        group_by_file=True,
    )

    result = nia_grep.sync(repository_id=repo_id, client=client, body=body)

    if result is None:
        em.emit(A, EVENT_LOG, "querying_nia", "Grep: no results")
        return {"pattern": pattern, "matches": []}

    # Normalize the grep response into a plain list/dict
    try:
        if isinstance(result, dict):
            matches = result.get("matches", [])
        elif hasattr(result, "to_dict"):
            data = result.to_dict()
            matches = data.get("matches", data)
        elif hasattr(result, "additional_properties"):
            matches = dict(result.additional_properties)
        else:
            matches = str(result)

        if hasattr(matches, "to_dict"):
            matches = matches.to_dict()
        elif hasattr(matches, "additional_properties"):
            matches = dict(matches.additional_properties)

        if not isinstance(matches, (list, dict, str)):
            matches = str(matches)

    except Exception as e:
        em.emit(A, EVENT_LOG, "querying_nia", f"Grep: error parsing result: {e}")
        matches = []

    match_count = len(matches) if isinstance(matches, (list, dict)) else "?"
    em.emit(A, EVENT_LOG, "querying_nia", f"Grep: {match_count} matches found")
    return {"pattern": pattern, "matches": matches}


def _collect_evidence_nia(
    client: AuthenticatedClient,
    repo_id: str,
    questions: list[str],
    grep_patterns: list[str],
    em: EventEmitter | None = None,
) -> list[dict]:
    """Send all questions + grep patterns to Nia and collect evidence."""
    em = em or get_default_emitter()

    em.emit(A, EVENT_PROGRESS, "collecting_evidence",
            f"Collecting evidence via Nia: {len(questions)} questions, {len(grep_patterns)} grep patterns")

    evidence = []

    for i, question in enumerate(questions, 1):
        ev = _nia_query_question(client, repo_id, question, i, em)
        evidence.append(ev)

    for pattern in grep_patterns:
        grep_ev = _nia_grep_pattern(client, repo_id, pattern, em)
        matches = grep_ev["matches"]
        if matches:
            try:
                matches_text = json.dumps(matches, indent=2, default=str)[:2000]
            except (TypeError, ValueError):
                matches_text = str(matches)[:2000]

            if isinstance(matches, dict):
                sources = [{"file_path": k, "content": v} for k, v in matches.items()]
            elif isinstance(matches, list):
                sources = matches
            else:
                sources = [{"content": str(matches)}]

            evidence.append({
                "question": f"[Grep: {pattern}]",
                "answer": f"Found code matching pattern '{pattern}':\n{matches_text}",
                "sources": sources,
            })

    em.emit(A, EVENT_PROGRESS, "collecting_evidence",
            f"Evidence collection complete: {len(evidence)} pieces")

    return evidence


# ═══════════════════════════════════════════════════════════════════
#  STEP 2b: LOCAL EVIDENCE COLLECTION (fallback)
# ═══════════════════════════════════════════════════════════════════

def clone_repo(repo_url: str, dest: str, depth: int = 1) -> str:
    """Shallow-clone a repo into dest."""
    subprocess.run(
        ["git", "clone", "--depth", str(depth), repo_url, dest],
        check=True, capture_output=True, text=True,
    )
    return dest


def build_file_index(repo_path: str) -> list[dict]:
    """Walk the repo and build a local file index."""
    repo = Path(repo_path)
    index = []

    for fpath in sorted(repo.rglob("*")):
        if any(part in IGNORE_DIRS for part in fpath.parts):
            continue
        if not fpath.is_file():
            continue
        if fpath.suffix.lower() not in CODE_EXTENSIONS:
            continue

        rel_path = str(fpath.relative_to(repo))
        size = fpath.stat().st_size

        preview = ""
        try:
            with open(fpath, "r", errors="ignore") as f:
                lines = []
                for i, line in enumerate(f):
                    if i >= PREVIEW_LINES:
                        break
                    lines.append(line)
                preview = "".join(lines)
        except Exception:
            preview = "(binary or unreadable)"

        index.append({
            "path": rel_path, "ext": fpath.suffix,
            "size": size, "preview": preview,
        })
        if len(index) >= MAX_INDEX_FILES:
            break

    return index


def read_file_content(repo_path: str, file_path: str, max_lines: int = 300) -> str:
    """Read a file from the repo, capped at max_lines, with line numbers."""
    full_path = Path(repo_path) / file_path
    if not full_path.exists():
        return f"(file not found: {file_path})"
    try:
        with open(full_path, "r", errors="ignore") as f:
            lines = []
            for i, line in enumerate(f, 1):
                if i > max_lines:
                    lines.append(f"\n... (truncated at {max_lines} lines)")
                    break
                lines.append(f"{i:>4}| {line}")
            return "".join(lines)
    except Exception as e:
        return f"(error reading {file_path}: {e})"


def _local_grep(repo_path: str, pattern: str, max_results: int = 50) -> list[dict]:
    """Grep the local repo for a pattern."""
    results = []
    repo = Path(repo_path)

    try:
        compiled = re.compile(pattern, re.IGNORECASE)
    except re.error:
        compiled = re.compile(re.escape(pattern), re.IGNORECASE)

    for fpath in sorted(repo.rglob("*")):
        if any(part in IGNORE_DIRS for part in fpath.parts):
            continue
        if not fpath.is_file():
            continue
        if fpath.suffix.lower() not in CODE_EXTENSIONS:
            continue

        rel_path = str(fpath.relative_to(repo))
        try:
            with open(fpath, "r", errors="ignore") as f:
                for line_no, line in enumerate(f, 1):
                    if compiled.search(line):
                        results.append({
                            "file": rel_path,
                            "line": line_no,
                            "content": line.rstrip(),
                        })
                        if len(results) >= max_results:
                            return results
        except Exception:
            continue

    return results


def _collect_evidence_local(
    repo_path: str,
    questions: list[str],
    grep_patterns: list[str],
    issue_title: str,
    issue_body: str,
    triage_result: dict | None,
    model: str,
    em: EventEmitter | None = None,
) -> list[dict]:
    """Collect evidence locally: file index + Claude answers + local grep."""
    em = em or get_default_emitter()

    em.emit(A, EVENT_PROGRESS, "collecting_evidence",
            f"Building file index for {repo_path}...")
    file_index = build_file_index(repo_path)
    em.emit(A, EVENT_PROGRESS, "collecting_evidence",
            f"Indexed {len(file_index)} files")

    all_contents = {}
    for f in file_index:
        all_contents[f["path"]] = read_file_content(repo_path, f["path"])

    files_text = "\n\n".join(
        f"=== {path} ===\n{content}"
        for path, content in all_contents.items()
    )

    evidence = []

    em.emit(A, EVENT_PROGRESS, "collecting_evidence",
            f"Answering {len(questions)} questions using Claude + local files...")

    for i, question in enumerate(questions, 1):
        em.emit(A, EVENT_PROGRESS, "collecting_evidence",
                f"Answering Q{i}: \"{question}\"")

        answer_prompt = (
            f"You are analyzing a codebase to answer this investigation question:\n\n"
            f"Question: {question}\n\n"
            f"Here is the full codebase:\n\n{files_text}\n\n"
            f"Provide a concise but specific answer citing exact file names and line numbers. "
            f"Include relevant code snippets."
        )

        answer_raw = _call_claude(
            "You are a code analysis expert. Answer the question based on the provided code. "
            "Be specific about file paths, line numbers, and include relevant code snippets.",
            answer_prompt,
            model,
        )

        answer_preview = answer_raw[:200] + "..." if len(answer_raw) > 200 else answer_raw
        em.emit(A, EVENT_LOG, "collecting_evidence",
                f"Q{i} answer: {answer_preview}")

        referenced_files = []
        for f in file_index:
            if f["path"] in answer_raw:
                referenced_files.append(f["path"])

        evidence.append({
            "question": question,
            "answer": answer_raw,
            "sources": [{"file_path": fp} for fp in referenced_files],
        })

    # Run grep patterns locally
    for pattern in grep_patterns:
        em.emit(A, EVENT_LOG, "collecting_evidence", f"Grep: \"{pattern}\"")
        matches = _local_grep(repo_path, pattern)
        em.emit(A, EVENT_LOG, "collecting_evidence",
                f"Grep: {len(matches)} matches found")

        if matches:
            matches_text = "\n".join(
                f"  {m['file']}:{m['line']}: {m['content']}"
                for m in matches[:30]
            )
            evidence.append({
                "question": f"[Grep: {pattern}]",
                "answer": f"Found {len(matches)} matches for pattern '{pattern}':\n{matches_text}",
                "sources": [{"file_path": m["file"], "line": m["line"]} for m in matches],
            })

    em.emit(A, EVENT_PROGRESS, "collecting_evidence",
            f"Evidence collection complete: {len(evidence)} pieces")

    return evidence


# ═══════════════════════════════════════════════════════════════════
#  STEP 3: CLAUDE GENERATES FINAL REPORT FROM EVIDENCE
# ═══════════════════════════════════════════════════════════════════

def _generate_report(
    issue_title: str,
    issue_body: str,
    triage_result: dict | None,
    evidence: list[dict],
    model: str,
    em: EventEmitter | None = None,
) -> dict:
    """Feed all evidence back to Claude to produce the final investigation report."""
    em = em or get_default_emitter()

    em.emit(A, EVENT_PROGRESS, "generating_report",
            f"Claude analyzing {len(evidence)} pieces of evidence...")

    context = _build_issue_context(issue_title, issue_body, "", triage_result)

    evidence_text = ""
    for i, ev in enumerate(evidence, 1):
        evidence_text += f"\n{'='*60}\n"
        evidence_text += f"Evidence #{i}\n"
        evidence_text += f"Question: {ev['question']}\n"
        evidence_text += f"{'─'*40}\n"
        evidence_text += f"Answer:\n{ev['answer']}\n"

        sources = ev.get("sources", [])
        if sources:
            evidence_text += f"{'─'*40}\n"
            evidence_text += "Referenced sources:\n"
            for src in sources[:10]:
                if isinstance(src, dict):
                    fp = src.get("file_path", src.get("path", src.get("file", "?")))
                    line = src.get("line", "")
                    evidence_text += f"  - {fp}"
                    if line:
                        evidence_text += f" (line {line})"
                    evidence_text += "\n"
                elif isinstance(src, str):
                    evidence_text += f"  - {src}\n"

    report_msg = (
        f"{context}\n\n"
        f"Below is all the evidence collected from investigating the codebase:\n"
        f"{evidence_text}\n\n"
        f"Based on this evidence, produce the investigation report."
    )

    raw = _call_claude(REPORT_SYSTEM_PROMPT, report_msg, model)
    result = _parse_json_safe(raw, {
        "suspect_files": [], "reasoning": "", "confidence": "low",
    }, em)

    if "suspect_files" not in result:
        result["suspect_files"] = []
    if "reasoning" not in result:
        result["reasoning"] = ""
    if "confidence" not in result:
        result["confidence"] = "medium"

    result["questions_asked"] = [ev["question"] for ev in evidence]
    result["evidence_collected"] = evidence

    em.emit(A, EVENT_PROGRESS, "generating_report",
            f"Report: {len(result['suspect_files'])} suspect files, confidence={result['confidence']}")

    return result


# ═══════════════════════════════════════════════════════════════════
#  MAIN ENTRY POINT
# ═══════════════════════════════════════════════════════════════════

def search_codebase(
    issue_title: str,
    issue_body: str,
    repo_url: str,
    repo_name: str = "",
    triage_result: dict | None = None,
    model: str = "claude-sonnet-4-20250514",
    clone_dir: str | None = None,
    emitter: EventEmitter | None = None,
) -> dict:
    """Run the codebase search agent.

    Args:
        issue_title: The bug/issue title.
        issue_body: The bug/issue description.
        repo_url: Git URL or local directory path.
        repo_name: Human-readable repo name (e.g. 'owner/repo').
        triage_result: Optional output from the triage agent.
        model: Claude model to use.
        clone_dir: Optional pre-existing clone directory.
        emitter: Optional event emitter for status updates.

    Returns:
        Structured investigation report as a dict.
    """
    em = emitter or get_default_emitter()

    em.emit(A, EVENT_STATUS, "starting",
            "═" * 58)
    em.emit(A, EVENT_STATUS, "starting",
            "  CODEBASE SEARCH AGENT — Starting investigation")
    em.emit(A, EVENT_STATUS, "starting",
            "═" * 58)
    em.emit(A, EVENT_STATUS, "starting", "Codebase Search Agent starting", {
        "issue_title": issue_title,
        "repo_url": repo_url,
        "repo_name": repo_name,
    })

    # ── Step 1: Claude generates questions ────────────────────────
    em.emit(A, EVENT_STATUS, "generating_questions",
            "STEP 1/3: Generating investigation questions")

    questions, grep_patterns = _generate_questions(
        issue_title, issue_body, triage_result, model, em,
    )

    if not questions:
        em.emit(A, EVENT_ERROR, "generating_questions", "No questions generated — aborting")
        return {
            "suspect_files": [], "reasoning": "Failed to generate questions.",
            "confidence": "low", "questions_asked": [], "evidence_collected": [],
        }

    # ── Step 2: Collect evidence ─────────────────────────────────
    em.emit(A, EVENT_STATUS, "collecting_evidence",
            "STEP 2/3: Collecting evidence from codebase")

    # Determine search strategy
    is_local = (clone_dir and Path(clone_dir).exists()) or Path(repo_url).is_dir()
    nia_client = _get_nia_client()
    github_repo = None if is_local else _extract_github_repo(repo_url, repo_name)

    # ── Nia status ────────────────────────────────────────────────
    if nia_client:
        em.emit(A, EVENT_PROGRESS, "collecting_evidence",
                "✓ NIA_API_KEY is set — Nia client initialized")
    else:
        em.emit(A, EVENT_PROGRESS, "collecting_evidence",
                "✗ NIA_API_KEY not set or placeholder — Nia disabled")

    if is_local:
        em.emit(A, EVENT_PROGRESS, "collecting_evidence",
                f"✗ Source is a local directory ({clone_dir or repo_url}) — Nia requires a GitHub repo")
        em.emit(A, EVENT_PROGRESS, "collecting_evidence",
                "  → Using local file search + Claude as fallback")
    elif github_repo:
        em.emit(A, EVENT_PROGRESS, "collecting_evidence",
                f"✓ GitHub repo detected: {github_repo}")
    else:
        em.emit(A, EVENT_PROGRESS, "collecting_evidence",
                f"✗ Could not extract GitHub repo from: {repo_url}")

    if nia_client and github_repo:
        # ── Nia path ──────────────────────────────────────────────
        em.emit(A, EVENT_PROGRESS, "nia_indexing",
                f"Using Nia for codebase search (repo: {github_repo})")
        repo_id = _nia_index_repo(nia_client, github_repo, em=em)

        if repo_id:
            evidence = _collect_evidence_nia(
                nia_client, repo_id, questions, grep_patterns, em,
            )
        else:
            em.emit(A, EVENT_ERROR, "nia_indexing", "Indexing failed — cannot query Nia")
            evidence = []
    else:
        # ── Local path ────────────────────────────────────────────
        tmp_dir = None
        if clone_dir and Path(clone_dir).exists():
            repo_path = clone_dir
        elif Path(repo_url).is_dir():
            repo_path = str(Path(repo_url))
        else:
            tmp_dir = tempfile.mkdtemp(prefix="bugpilot_")
            repo_path = os.path.join(tmp_dir, "repo")
            em.emit(A, EVENT_PROGRESS, "collecting_evidence",
                    f"Cloning {repo_url}...")
            clone_repo(repo_url, repo_path)

        try:
            evidence = _collect_evidence_local(
                repo_path, questions, grep_patterns,
                issue_title, issue_body, triage_result, model, em,
            )
        finally:
            if tmp_dir and os.path.exists(tmp_dir):
                shutil.rmtree(tmp_dir, ignore_errors=True)

    if not evidence:
        em.emit(A, EVENT_ERROR, "collecting_evidence", "No evidence collected — aborting")
        return {
            "suspect_files": [], "reasoning": "Failed to collect evidence.",
            "confidence": "low",
            "questions_asked": [q for q in questions],
            "evidence_collected": [],
        }

    # ── Step 3: Claude analyzes evidence → report ────────────────
    em.emit(A, EVENT_STATUS, "generating_report",
            "STEP 3/3: Claude analyzing evidence → final report")

    report = _generate_report(
        issue_title, issue_body, triage_result, evidence, model, em,
    )

    em.emit(A, EVENT_RESULT, "complete",
            "Investigation complete", {"report_summary": {
                "suspect_files": len(report.get("suspect_files", [])),
                "confidence": report.get("confidence", "unknown"),
            }})

    em.emit(A, EVENT_STATUS, "complete",
            "═" * 58)
    em.emit(A, EVENT_STATUS, "complete",
            "  CODEBASE SEARCH AGENT — Investigation complete")
    em.emit(A, EVENT_STATUS, "complete",
            "═" * 58)

    return report


# ═══════════════════════════════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════════════════════════════

def _extract_github_repo(repo_url: str, repo_name: str) -> str | None:
    """Extract 'owner/repo' from a URL or repo_name. Returns None for local paths."""
    if repo_name and "/" in repo_name and not repo_name.startswith("/"):
        parts = repo_name.split("/")
        if len(parts) == 2 and not Path(repo_name).exists():
            return repo_name

    if "github.com" in repo_url:
        parts = repo_url.rstrip("/").rstrip(".git").split("github.com/")
        if len(parts) == 2:
            return parts[1]

    return None
