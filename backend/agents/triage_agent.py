"""
Triage Agent — classifies GitHub issues using an LLM.

Takes a GitHub issue (title + body) and returns structured JSON:
  - severity: critical | high | medium | low
  - likely_module: which part of the codebase is affected
  - is_duplicate: whether this looks like a known/duplicate issue
  - duplicate_of: description of the suspected original (if duplicate)
  - summary: ≤5-line Slack-ready summary
"""

import json

from llm import call_llm, get_default_model
from events import (
    EventEmitter,
    get_default_emitter,
    AGENT_TRIAGE,
    EVENT_STATUS,
    EVENT_PROGRESS,
    EVENT_RESULT,
    EVENT_ERROR,
    EVENT_LOG,
    EVENT_SUMMARY,
)


TRIAGE_SYSTEM_PROMPT = """\
You are a senior software triage engineer. Your job is to analyze incoming
GitHub issues and produce a structured triage report.

For every issue you receive, you MUST return ONLY a valid JSON object with
exactly these fields:

{
  "severity": "<critical | high | medium | low>",
  "likely_module": "<string — the likely area/module of the codebase affected>",
  "is_duplicate": <true | false>,
  "duplicate_of": "<string or null — brief description of the suspected original issue if duplicate>",
  "summary": "<string — a concise Slack-ready summary, max 5 lines>"
}

Severity classification guidelines:
  - critical: data loss, security vulnerability, complete service outage
  - high: major feature broken, significant user impact, no workaround
  - medium: feature partially broken, workaround exists, moderate user impact
  - low: cosmetic issue, minor inconvenience, feature request, docs

For likely_module, infer from the issue content which part of the system is
affected (e.g. "auth", "api", "frontend/dashboard", "database", "ci/cd",
"payments", "notifications", etc). If unclear, use "unknown".

For duplicate detection, look for patterns that suggest this is a re-report
of a known class of issue. If you cannot determine, set is_duplicate to false.

The summary should be readable in Slack — use plain text, no markdown.
Keep it to 5 lines max. First line should be a one-sentence description.
Remaining lines can include key details like affected users, reproduction
steps, or suggested next actions.

Return ONLY the JSON object. No explanation, no markdown fences, no extra text.
"""


def triage_issue(
    issue_title: str,
    issue_body: str,
    repo_name: str = "",
    existing_issues: list[str] | None = None,
    model: str | None = None,
    emitter: EventEmitter | None = None,
) -> dict:
    """Run the triage agent on a GitHub issue.

    Args:
        issue_title: The GitHub issue title.
        issue_body: The GitHub issue body/description.
        repo_name: Optional repo name for context.
        existing_issues: Optional list of existing issue titles for duplicate detection.
        model: Claude model to use.
        emitter: Optional event emitter for status updates.

    Returns:
        Structured triage result as a dict.
    """
    em = emitter or get_default_emitter()
    A = AGENT_TRIAGE  # shorthand
    model = model or get_default_model()

    # ── Starting ──────────────────────────────────────────────────
    em.emit(A, EVENT_STATUS, "starting", "Triage Agent starting", {
        "issue_title": issue_title,
        "repo_name": repo_name,
    })

    em.emit(A, EVENT_STATUS, "starting",
            "═" * 58)
    em.emit(A, EVENT_STATUS, "starting",
            "  TRIAGE AGENT — Analyzing issue")
    em.emit(A, EVENT_STATUS, "starting",
            "═" * 58)

    # ── Build prompt ──────────────────────────────────────────────
    em.emit(A, EVENT_PROGRESS, "building_prompt",
            f"Building prompt for: \"{issue_title}\"")

    user_message = f"Issue Title: {issue_title}\n\n"
    user_message += f"Issue Body:\n{issue_body or '(no description provided)'}\n"

    if repo_name:
        user_message += f"\nRepository: {repo_name}\n"

    if existing_issues:
        user_message += "\nExisting open issues (for duplicate detection):\n"
        for i, title in enumerate(existing_issues[:20], 1):
            user_message += f"  {i}. {title}\n"

    em.emit(A, EVENT_LOG, "building_prompt",
            f"Prompt built ({len(user_message)} chars)")

    # ── Call LLM ──────────────────────────────────────────────────
    em.emit(A, EVENT_PROGRESS, "calling_llm",
            f"Calling LLM ({model}) for triage analysis...")

    try:
        raw_text = call_llm(
            system=TRIAGE_SYSTEM_PROMPT,
            user_msg=user_message,
            model=model,
            max_tokens=1024,
        )
    except Exception as e:
        em.emit(A, EVENT_ERROR, "calling_llm", f"LLM API error: {e}")
        raise

    em.emit(A, EVENT_LOG, "calling_llm",
            f"Received response ({len(raw_text)} chars)")

    # ── Parse JSON ───────────────────────────────────────────────
    em.emit(A, EVENT_PROGRESS, "parsing_response",
            "Parsing LLM response...")

    try:
        result = json.loads(raw_text)
    except json.JSONDecodeError:
        # Fallback: extract JSON object and fix invalid escapes
        import re as _re
        start = raw_text.find("{")
        end = raw_text.rfind("}") + 1
        if start >= 0 and end > start:
            snippet = raw_text[start:end]
            # Fix invalid JSON escapes (e.g. \s \d from regex patterns)
            fixed = _re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', snippet)
            try:
                result = json.loads(fixed)
            except json.JSONDecodeError as e2:
                em.emit(A, EVENT_ERROR, "parsing_response",
                        f"Failed to parse JSON even after fix: {e2}")
                em.emit(A, EVENT_LOG, "parsing_response",
                        f"Raw response: {raw_text[:500]}")
                raise
        else:
            em.emit(A, EVENT_ERROR, "parsing_response",
                    f"No JSON object found in response")
            em.emit(A, EVENT_LOG, "parsing_response",
                    f"Raw response: {raw_text[:500]}")
            raise ValueError("No JSON object in LLM response")

    # ── Validate ─────────────────────────────────────────────────
    expected_keys = {"severity", "likely_module", "is_duplicate", "duplicate_of", "summary"}
    missing = expected_keys - set(result.keys())
    if missing:
        em.emit(A, EVENT_ERROR, "validating",
                f"Response missing fields: {missing}")
        raise ValueError(f"Triage response missing fields: {missing}")

    # ── Report results ───────────────────────────────────────────
    em.emit(A, EVENT_PROGRESS, "complete",
            f"Severity: {result['severity'].upper()}")
    em.emit(A, EVENT_PROGRESS, "complete",
            f"Likely module: {result['likely_module']}")
    em.emit(A, EVENT_PROGRESS, "complete",
            f"Duplicate: {'Yes → ' + result['duplicate_of'] if result['is_duplicate'] else 'No'}")
    em.emit(A, EVENT_LOG, "complete",
            f"Summary: {result['summary'][:150]}...")

    em.emit(A, EVENT_RESULT, "complete",
            "Triage complete", {"triage_result": result})

    # ── Summary for frontend ─────────────────────────────────────
    em.emit(A, EVENT_SUMMARY, "summary",
            "Triage Summary", {
                "severity": result["severity"].upper(),
                "likely_module": result["likely_module"],
                "is_duplicate": "Yes" if result["is_duplicate"] else "No",
                "findings": [result["summary"]],
            })

    em.emit(A, EVENT_STATUS, "complete",
            "═" * 58)
    em.emit(A, EVENT_STATUS, "complete",
            "  TRIAGE AGENT — Complete")
    em.emit(A, EVENT_STATUS, "complete",
            "═" * 58)

    return result
