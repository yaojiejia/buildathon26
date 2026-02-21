"""
Codebase Search Agent — LLM + Nia collaborative investigation.

Workflow:
  1. CLAUDE: Generate 3-5 targeted investigation questions from the bug report
  2. NIA:    For each question, query the indexed codebase for concrete evidence
  3. CLAUDE: Analyze all collected evidence and produce a structured report

For local directories (no Nia), the same workflow applies but questions are
answered via local file search + an LLM instead of Nia.

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

from llm import call_llm, get_default_model

# ── Nia SDK imports ──────────────────────────────────────────────
from nia_py import AuthenticatedClient
from nia_py.api.v2_api import (
    query_repositories_v2_v2_query_post as nia_query,
    grep_repository_v2_v2_repositories_repository_id_grep_post as nia_grep,
)
from nia_py.models import (
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
    EVENT_SUMMARY,
)

# ── Constants ────────────────────────────────────────────────────

A = AGENT_CODEBASE_SEARCH  # shorthand for event emission

NIA_BASE_URL = "https://apigcp.trynia.ai/v2"
MAX_SUSPECT_FILES = 10
MAX_QUESTIONS = 5
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
#  LLM PROMPTS
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

def _call_model(system: str, user_msg: str, model: str) -> str:
    """Call the configured LLM and return the text response."""
    return call_llm(system=system, user_msg=user_msg, model=model)


def _fix_json_escapes(text: str) -> str:
    """Fix invalid JSON escape sequences (e.g. \\s, \\d from regex patterns).

    JSON only allows: \\\\ \\/ \\\" \\b \\f \\n \\r \\t \\uXXXX
    Anything else (like \\s \\w \\d from regexes) must be double-escaped.
    """
    import re as _re
    # Match a single backslash NOT followed by a valid JSON escape char
    return _re.sub(
        r'\\(?!["\\/bfnrtu])',
        r'\\\\',
        text,
    )


def _strip_json_comments(text: str) -> str:
    """Strip // and /* */ comments while preserving quoted strings."""
    out = []
    i = 0
    in_str = False
    escape = False
    n = len(text)

    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""

        if in_str:
            out.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            i += 1
            continue

        if ch == '"':
            in_str = True
            out.append(ch)
            i += 1
            continue

        if ch == "/" and nxt == "/":
            i += 2
            while i < n and text[i] != "\n":
                i += 1
            continue

        if ch == "/" and nxt == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue

        out.append(ch)
        i += 1

    return "".join(out)


def _remove_trailing_commas(text: str) -> str:
    """Remove trailing commas before closing } or ] in JSON-ish text."""
    import re as _re
    return _re.sub(r",\s*([}\]])", r"\1", text)


def _extract_list_strings(raw: str, key: str) -> list[str]:
    """Last-resort extraction of string items from an array field."""
    import re as _re
    m = _re.search(rf'"{_re.escape(key)}"\s*:\s*\[(.*?)\]', raw, _re.DOTALL)
    if not m:
        return []
    body = m.group(1)
    return [s for s in _re.findall(r'"((?:\\.|[^"\\])*)"', body)]


def _parse_json_safe(raw: str, fallback: dict | None = None, em: EventEmitter | None = None) -> dict:
    """Parse JSON from LLM response with robust fallback for invalid escapes."""
    em = em or get_default_emitter()

    # Try direct parse first
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        em.emit(A, EVENT_LOG, "json_parse", f"Direct parse failed: {e}")

    # Extract the JSON object substring
    start = raw.find("{")
    end = raw.rfind("}") + 1
    if start < 0 or end <= start:
        em.emit(A, EVENT_LOG, "json_parse", f"No JSON object found in response (len={len(raw)})")
        return fallback or {}

    snippet = raw[start:end]

    # Try parsing the extracted snippet
    try:
        return json.loads(snippet)
    except json.JSONDecodeError as e2:
        em.emit(A, EVENT_LOG, "json_parse", f"Snippet parse failed: {e2}")

    # Try parsing after removing comments/trailing commas
    cleaned = _remove_trailing_commas(_strip_json_comments(snippet))
    try:
        result = json.loads(cleaned)
        em.emit(A, EVENT_LOG, "json_parse", "Parsed after stripping comments/trailing commas")
        return result
    except json.JSONDecodeError as e_clean:
        em.emit(A, EVENT_LOG, "json_parse", f"Parse after comment cleanup failed: {e_clean}")

    # Fix invalid escape sequences (common with regex patterns from LLMs)
    fixed = _fix_json_escapes(cleaned)
    try:
        result = json.loads(fixed)
        em.emit(A, EVENT_LOG, "json_parse", "Parsed after fixing escape sequences")
        return result
    except json.JSONDecodeError as e3:
        em.emit(A, EVENT_LOG, "json_parse", f"Parse after escape fix also failed: {e3}")

    # Last-resort structured extraction for known schema fields
    questions = _extract_list_strings(raw, "questions")
    patterns = _extract_list_strings(raw, "grep_patterns")
    if questions or patterns:
        em.emit(A, EVENT_LOG, "json_parse",
                f"Recovered fields via heuristic extraction (questions={len(questions)}, patterns={len(patterns)})")
        return {"questions": questions, "grep_patterns": patterns}

    return fallback or {}


def _build_issue_context(
    issue_title: str,
    issue_body: str,
    repo_name: str,
    triage_result: dict | None,
) -> str:
    """Build the issue context string for LLM prompts."""
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
#  STEP 1: LLM GENERATES INVESTIGATION QUESTIONS
# ═══════════════════════════════════════════════════════════════════

def _generate_questions(
    issue_title: str,
    issue_body: str,
    triage_result: dict | None,
    model: str,
    max_questions: int = MAX_QUESTIONS,
    em: EventEmitter | None = None,
) -> tuple[list[str], list[str]]:
    """Ask the LLM to generate targeted investigation questions + grep patterns."""
    em = em or get_default_emitter()

    em.emit(A, EVENT_PROGRESS, "generating_questions",
            f"Asking LLM ({model}) to generate investigation questions...")

    context = _build_issue_context(issue_title, issue_body, "", triage_result)
    em.emit(A, EVENT_LOG, "generating_questions",
            f"Context built ({len(context)} chars)")

    try:
        raw = _call_model(QUESTION_GEN_SYSTEM_PROMPT, context, model)
    except Exception as e:
        em.emit(A, EVENT_ERROR, "generating_questions", f"LLM API error: {e}")
        return [], []

    em.emit(A, EVENT_LOG, "generating_questions",
            f"LLM responded ({len(raw)} chars)")

    # Show full response for debugging
    for line in raw.splitlines():
        em.emit(A, EVENT_LOG, "generating_questions", f"  | {line}")

    parsed = _parse_json_safe(raw, {"questions": [], "grep_patterns": []}, em)
    if not parsed.get("questions"):
        em.emit(A, EVENT_ERROR, "generating_questions",
                f"No questions in parsed result. Keys: {list(parsed.keys())}")

    max_questions = max(1, min(int(max_questions), 10))
    questions = parsed.get("questions", [])[:max_questions]
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
#  NIA CLIENT
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


# ═══════════════════════════════════════════════════════════════════
#  STEP 2a: QUERY NIA FOR EVIDENCE
# ═══════════════════════════════════════════════════════════════════

def _nia_query_question(
    client: AuthenticatedClient,
    repo_ref: str,
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
        repositories=[repo_ref],
        include_sources=True,
        skip_llm=False,
    )
    try:
        result = nia_query.sync(client=client, body=body)
    except Exception as e:
        em.emit(A, EVENT_ERROR, "querying_nia", f"Q{question_idx}: query failed: {e}")
        return {"question": question, "answer": "(query failed)", "sources": []}

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
    repo_ref: str,
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

    try:
        result = nia_grep.sync(repository_id=repo_ref, client=client, body=body)
    except Exception as e:
        em.emit(A, EVENT_LOG, "querying_nia", f"Grep failed for '{pattern}': {e}")
        return {"pattern": pattern, "matches": []}

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
    repo_ref: str,
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
        ev = _nia_query_question(client, repo_ref, question, i, em)
        evidence.append(ev)

    for pattern in grep_patterns:
        grep_ev = _nia_grep_pattern(client, repo_ref, pattern, em)
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


def _normalize_repo_url(repo_url: str) -> str:
    """Normalize shorthand GitHub URLs for clone operations."""
    u = (repo_url or "").strip()
    if u.startswith("github.com/"):
        return "https://" + u
    return u


# ═══════════════════════════════════════════════════════════════════
#  STEP 2b: LOCAL EVIDENCE COLLECTION (fallback)
# ═══════════════════════════════════════════════════════════════════

def clone_repo(repo_url: str, dest: str, depth: int = 1) -> str:
    """Shallow-clone a repo into dest."""
    normalized_url = _normalize_repo_url(repo_url)
    subprocess.run(
        ["git", "clone", "--depth", str(depth), normalized_url, dest],
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
    """Collect evidence locally: file index + LLM answers + local grep."""
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
            f"Answering {len(questions)} questions using LLM + local files...")

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

        answer_raw = _call_model(
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
#  STEP 3: LLM GENERATES FINAL REPORT FROM EVIDENCE
# ═══════════════════════════════════════════════════════════════════

def _generate_report(
    issue_title: str,
    issue_body: str,
    triage_result: dict | None,
    evidence: list[dict],
    model: str,
    em: EventEmitter | None = None,
) -> dict:
    """Feed all evidence back to the LLM to produce the final investigation report."""
    em = em or get_default_emitter()

    em.emit(A, EVENT_PROGRESS, "generating_report",
            f"LLM ({model}) analyzing {len(evidence)} pieces of evidence...")

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

    raw = _call_model(REPORT_SYSTEM_PROMPT, report_msg, model)
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
    model: str | None = None,
    num_questions: int = MAX_QUESTIONS,
    clone_dir: str | None = None,
    force_reindex: bool = False,
    emitter: EventEmitter | None = None,
) -> dict:
    """Run the codebase search agent.

    Args:
        issue_title: The bug/issue title.
        issue_body: The bug/issue description.
        repo_url: Git URL or local directory path.
        repo_name: Human-readable repo name (e.g. 'owner/repo').
        triage_result: Optional output from the triage agent.
        model: LLM model to use.
        num_questions: Number of investigation questions to ask (1-10).
        clone_dir: Optional pre-existing clone directory.
        force_reindex: Deprecated/no-op for Nia path (indexing is skipped).
        emitter: Optional event emitter for status updates.

    Returns:
        Structured investigation report as a dict.
    """
    em = emitter or get_default_emitter()
    model = model or get_default_model()

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

    # ── Step 1: LLM generates questions ───────────────────────────
    em.emit(A, EVENT_STATUS, "generating_questions",
            "STEP 1/3: Generating investigation questions")

    questions, grep_patterns = _generate_questions(
        issue_title, issue_body, triage_result, model, num_questions, em,
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
                "  → Using local file search + LLM as fallback")
    elif github_repo:
        em.emit(A, EVENT_PROGRESS, "collecting_evidence",
                f"✓ GitHub repo detected: {github_repo}")
    else:
        em.emit(A, EVENT_PROGRESS, "collecting_evidence",
                f"✗ Could not extract GitHub repo from: {repo_url}")

    if nia_client and github_repo:
        # ── Nia path ──────────────────────────────────────────────
        em.emit(A, EVENT_PROGRESS, "collecting_evidence",
                f"Using Nia for codebase search (repo: {github_repo})")
        if force_reindex:
            em.emit(A, EVENT_LOG, "collecting_evidence",
                    "force_reindex requested but ignored (indexing is disabled)")
        em.emit(A, EVENT_PROGRESS, "collecting_evidence",
                "Skipping all Nia indexing operations — querying directly")
        evidence = _collect_evidence_nia(
            nia_client, github_repo, questions, grep_patterns, em,
        )
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

    # ── Step 3: LLM analyzes evidence → report ───────────────────
    em.emit(A, EVENT_STATUS, "generating_report",
            f"STEP 3/3: LLM ({model}) analyzing evidence → final report")

    report = _generate_report(
        issue_title, issue_body, triage_result, evidence, model, em,
    )

    em.emit(A, EVENT_RESULT, "complete",
            "Investigation complete", {"report_summary": {
                "suspect_files": len(report.get("suspect_files", [])),
                "confidence": report.get("confidence", "unknown"),
            }})

    # ── Summary for frontend ─────────────────────────────────────
    suspect_files = report.get("suspect_files", [])
    summary_findings = []
    for sf in suspect_files[:5]:
        path = sf.get("file_path", "?")
        why = sf.get("why_relevant", "")
        lines = sf.get("lines_referenced", [])
        line_str = f" (lines {', '.join(str(l) for l in lines[:5])})" if lines else ""
        summary_findings.append(f"{path}{line_str} — {why[:100]}")

    em.emit(A, EVENT_SUMMARY, "summary",
            "Codebase Search Summary", {
                "confidence": report.get("confidence", "unknown"),
                "suspect_files_count": len(suspect_files),
                "questions_asked": len(report.get("questions_asked", [])),
                "evidence_pieces": len(report.get("evidence_collected", [])),
                "findings": summary_findings,
                "reasoning": report.get("reasoning", "")[:200],
            })

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
