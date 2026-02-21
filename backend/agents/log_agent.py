"""
Log Analysis Agent — queries Sentry for traces/logs related to a bug.

Workflow:
  1. Build search keywords from the triage result and issue description
  2. Query Sentry API for matching events, transactions, and breadcrumbs
  3. Feed the collected logs to the LLM for analysis
  4. Return structured findings: suspicious entries, patterns, and timeline

Required env vars:
  SENTRY_AUTH_TOKEN  — Sentry API auth token (https://sentry.io/settings/auth-tokens/)
  SENTRY_ORG        — Sentry organization slug
  SENTRY_PROJECT    — Sentry project slug

Output schema:
{
  "suspicious_logs": [
    {
      "event_id": "abc123",
      "timestamp": "2026-02-20T12:34:56Z",
      "message": "Refund processed: order_id=1 refund_amount=79.99 original_total=63.99",
      "level": "info",
      "why_suspicious": "Refund amount (79.99) differs from order total (63.99)"
    }
  ],
  "patterns_found": [
    "Refund amounts consistently higher than original order totals",
    "Discount calculations show stacking behavior"
  ],
  "timeline": "Summary of what happened in chronological order",
  "confidence": "high | medium | low",
  "total_events_scanned": 42
}
"""

import json
import os
import time
from datetime import datetime, timedelta, timezone

import requests

from llm import call_llm, get_default_model
from events import (
    EventEmitter,
    get_default_emitter,
    AGENT_LOG,
    EVENT_STATUS,
    EVENT_PROGRESS,
    EVENT_RESULT,
    EVENT_ERROR,
    EVENT_LOG,
    EVENT_SUMMARY,
)

# ── Constants ────────────────────────────────────────────────────

A = AGENT_LOG  # shorthand for event emission

SENTRY_API_BASE = "https://sentry.io/api/0"
MAX_EVENTS_PER_QUERY = 100
MAX_EVENTS_TO_ANALYZE = 50  # cap sent to LLM


# ═══════════════════════════════════════════════════════════════════
#  LLM PROMPTS
# ═══════════════════════════════════════════════════════════════════

KEYWORD_GEN_SYSTEM_PROMPT = """\
You are a senior debugging engineer. Given a bug report and triage context,
generate search keywords and Sentry query strings to find relevant log entries.

Return ONLY a valid JSON object:
{
  "keywords": ["refund", "discount", "order total", "price"],
  "sentry_queries": [
    "refund_amount",
    "process_refund",
    "calculate_discount"
  ],
  "log_levels": ["info", "warning", "error"]
}

- keywords: broad terms related to the bug (used for text search)
- sentry_queries: specific function names, variables, or messages to search
- log_levels: which log levels are most relevant
"""

LOG_ANALYSIS_SYSTEM_PROMPT = """\
You are a senior debugging engineer analyzing application logs from Sentry.

You are given:
1. A bug report describing the issue
2. Triage context (severity, likely module)
3. Raw log entries from the application's Sentry project

Your job is to find SUSPICIOUS log entries that indicate the bug is happening.
Look for:
- Values that don't match expectations (e.g. refund_amount ≠ order.total)
- Sequences of events that reveal the bug's behavior
- Missing log entries that should be present
- Error patterns or unexpected state transitions

Return ONLY a valid JSON object:
{
  "suspicious_logs": [
    {
      "event_id": "the sentry event ID",
      "timestamp": "ISO timestamp",
      "message": "The log message",
      "level": "info/warning/error",
      "why_suspicious": "Explanation of why this entry is suspicious"
    }
  ],
  "patterns_found": [
    "Description of each pattern observed across logs"
  ],
  "timeline": "Chronological narrative of what the logs reveal about the bug",
  "confidence": "high | medium | low"
}

Rules:
- Only flag entries that are genuinely suspicious — not every log line.
- Be specific about WHY each entry is suspicious.
- Connect the dots between entries to build a narrative.
- If no suspicious entries are found, say so honestly.
"""


# ═══════════════════════════════════════════════════════════════════
#  SENTRY API HELPERS
# ═══════════════════════════════════════════════════════════════════

def _get_sentry_config() -> dict | None:
    """Get Sentry API configuration from environment."""
    token = os.environ.get("SENTRY_AUTH_TOKEN", "").strip()
    org = os.environ.get("SENTRY_ORG", "").strip()
    project = os.environ.get("SENTRY_PROJECT", "").strip()

    if not token or not org or not project:
        return None

    return {
        "token": token,
        "org": org,
        "project": project,
        "headers": {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    }


def _sentry_get(
    config: dict,
    endpoint: str,
    params: dict | None = None,
    em: EventEmitter | None = None,
) -> list | dict | None:
    """Make a GET request to the Sentry API."""
    em = em or get_default_emitter()
    url = f"{SENTRY_API_BASE}{endpoint}"

    em.emit(A, EVENT_LOG, "sentry_api",
            f"GET {endpoint}" + (f" params={params}" if params else ""))

    try:
        resp = requests.get(url, headers=config["headers"], params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.HTTPError as e:
        em.emit(A, EVENT_ERROR, "sentry_api",
                f"HTTP {resp.status_code}: {resp.text[:200]}")
        return None
    except requests.exceptions.RequestException as e:
        em.emit(A, EVENT_ERROR, "sentry_api", f"Request failed: {e}")
        return None


def _fetch_project_events(
    config: dict,
    query: str = "",
    time_range_hours: int = 72,
    em: EventEmitter | None = None,
) -> list[dict]:
    """Fetch recent events from the Sentry project.

    Uses the /events/ endpoint with optional query filter.
    """
    em = em or get_default_emitter()
    org, project = config["org"], config["project"]

    params = {
        "full": "true",
        "per_page": str(MAX_EVENTS_PER_QUERY),
    }
    if query:
        params["query"] = query

    endpoint = f"/projects/{org}/{project}/events/"
    data = _sentry_get(config, endpoint, params, em)

    if isinstance(data, list):
        em.emit(A, EVENT_LOG, "sentry_api",
                f"Fetched {len(data)} events" + (f" (query={query})" if query else ""))
        return data
    elif isinstance(data, dict) and "detail" in data:
        em.emit(A, EVENT_ERROR, "sentry_api", f"API error: {data['detail']}")
    return []


def _fetch_project_issues(
    config: dict,
    query: str = "",
    em: EventEmitter | None = None,
) -> list[dict]:
    """Fetch recent issues from the Sentry project."""
    em = em or get_default_emitter()
    org, project = config["org"], config["project"]

    params = {
        "per_page": "25",
        "sort": "date",
    }
    if query:
        params["query"] = query

    endpoint = f"/projects/{org}/{project}/issues/"
    data = _sentry_get(config, endpoint, params, em)

    if isinstance(data, list):
        em.emit(A, EVENT_LOG, "sentry_api", f"Fetched {len(data)} issues")
        return data
    return []


def _fetch_event_detail(
    config: dict,
    event_id: str,
    em: EventEmitter | None = None,
) -> dict | None:
    """Fetch full detail of a single event including breadcrumbs."""
    em = em or get_default_emitter()
    org, project = config["org"], config["project"]

    endpoint = f"/projects/{org}/{project}/events/{event_id}/"
    return _sentry_get(config, endpoint, em=em)


def _fetch_issue_events(
    config: dict,
    issue_id: str,
    em: EventEmitter | None = None,
) -> list[dict]:
    """Fetch events belonging to a specific issue."""
    em = em or get_default_emitter()

    endpoint = f"/issues/{issue_id}/events/"
    params = {"full": "true", "per_page": "50"}
    data = _sentry_get(config, endpoint, params, em)

    if isinstance(data, list):
        return data
    return []


# ═══════════════════════════════════════════════════════════════════
#  STEP 1: GENERATE SEARCH KEYWORDS
# ═══════════════════════════════════════════════════════════════════

def _generate_search_keywords(
    issue_title: str,
    issue_body: str,
    triage_result: dict | None,
    model: str,
    em: EventEmitter | None = None,
) -> dict:
    """Ask the LLM to generate search keywords for Sentry queries."""
    em = em or get_default_emitter()

    em.emit(A, EVENT_PROGRESS, "generating_keywords",
            "Generating search keywords for Sentry log search...")

    context = f"Issue Title: {issue_title}\n"
    context += f"Issue Body: {issue_body or '(none)'}\n"
    if triage_result:
        context += f"Triage Severity: {triage_result.get('severity', 'unknown')}\n"
        context += f"Triage Module: {triage_result.get('likely_module', 'unknown')}\n"
        context += f"Triage Summary: {triage_result.get('summary', '')}\n"

    try:
        raw = call_llm(KEYWORD_GEN_SYSTEM_PROMPT, context, model)
    except Exception as e:
        em.emit(A, EVENT_ERROR, "generating_keywords", f"LLM error: {e}")
        return {"keywords": [], "sentry_queries": [], "log_levels": ["error", "warning"]}

    # Parse JSON
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        import re
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start >= 0 and end > start:
            fixed = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', raw[start:end])
            try:
                result = json.loads(fixed)
            except json.JSONDecodeError:
                result = {}
        else:
            result = {}

    keywords = result.get("keywords", [])
    sentry_queries = result.get("sentry_queries", [])
    log_levels = result.get("log_levels", ["error", "warning", "info"])

    em.emit(A, EVENT_PROGRESS, "generating_keywords",
            f"Keywords: {keywords}")
    em.emit(A, EVENT_PROGRESS, "generating_keywords",
            f"Sentry queries: {sentry_queries}")

    return {
        "keywords": keywords,
        "sentry_queries": sentry_queries,
        "log_levels": log_levels,
    }


# ═══════════════════════════════════════════════════════════════════
#  STEP 2: COLLECT LOGS FROM SENTRY
# ═══════════════════════════════════════════════════════════════════

def _normalize_event(event: dict) -> dict:
    """Extract the most useful fields from a Sentry event."""
    # Handle different event shapes
    message = (
        event.get("message", "")
        or event.get("title", "")
        or event.get("metadata", {}).get("value", "")
        or event.get("culprit", "")
    )

    # Extract breadcrumbs if present
    breadcrumbs = []
    entries = event.get("entries", [])
    for entry in entries:
        if entry.get("type") == "breadcrumbs":
            for crumb in entry.get("data", {}).get("values", []):
                breadcrumbs.append({
                    "timestamp": crumb.get("timestamp", ""),
                    "category": crumb.get("category", ""),
                    "message": crumb.get("message", ""),
                    "level": crumb.get("level", "info"),
                    "data": crumb.get("data", {}),
                })

    # Extract tags
    tags = {}
    for tag in event.get("tags", []):
        if isinstance(tag, dict):
            tags[tag.get("key", "")] = tag.get("value", "")
        elif isinstance(tag, (list, tuple)) and len(tag) == 2:
            tags[tag[0]] = tag[1]

    return {
        "event_id": event.get("eventID", event.get("id", "")),
        "timestamp": event.get("dateCreated", event.get("dateReceived", "")),
        "message": message,
        "level": event.get("level", tags.get("level", "info")),
        "title": event.get("title", ""),
        "tags": tags,
        "breadcrumbs": breadcrumbs,
        "context": event.get("context", event.get("contexts", {})),
        "transaction": event.get("transaction", tags.get("transaction", "")),
    }


def _collect_sentry_logs(
    config: dict,
    search_keywords: dict,
    em: EventEmitter | None = None,
) -> list[dict]:
    """Collect relevant logs from Sentry using multiple search strategies."""
    em = em or get_default_emitter()

    em.emit(A, EVENT_PROGRESS, "collecting_logs",
            "Querying Sentry for relevant logs...")

    all_events = []
    seen_ids = set()

    # Strategy 1: Fetch all recent events (broad scan)
    em.emit(A, EVENT_PROGRESS, "collecting_logs",
            "Fetching recent events (broad scan)...")
    events = _fetch_project_events(config, em=em)
    for ev in events:
        eid = ev.get("eventID", ev.get("id", ""))
        if eid and eid not in seen_ids:
            seen_ids.add(eid)
            all_events.append(ev)

    em.emit(A, EVENT_PROGRESS, "collecting_logs",
            f"Broad scan: {len(all_events)} events")

    # Strategy 2: Search with specific keywords
    for query in search_keywords.get("sentry_queries", []):
        em.emit(A, EVENT_LOG, "collecting_logs",
                f"Searching for: {query}")
        events = _fetch_project_events(config, query=query, em=em)
        for ev in events:
            eid = ev.get("eventID", ev.get("id", ""))
            if eid and eid not in seen_ids:
                seen_ids.add(eid)
                all_events.append(ev)

    em.emit(A, EVENT_PROGRESS, "collecting_logs",
            f"Total unique events collected: {len(all_events)}")

    # Strategy 3: Fetch recent issues and their events
    em.emit(A, EVENT_PROGRESS, "collecting_logs",
            "Checking recent issues...")
    issues = _fetch_project_issues(config, em=em)
    if issues:
        em.emit(A, EVENT_LOG, "collecting_logs",
                f"Found {len(issues)} recent issues")
        for issue in issues[:5]:  # top 5 most recent issues
            issue_id = issue.get("id", "")
            issue_title = issue.get("title", "")
            em.emit(A, EVENT_LOG, "collecting_logs",
                    f"  Issue #{issue_id}: {issue_title}")

    # Normalize all events
    normalized = [_normalize_event(ev) for ev in all_events]

    # Show all fetched events
    em.emit(A, EVENT_PROGRESS, "collecting_logs",
            f"{'─' * 50}")
    em.emit(A, EVENT_PROGRESS, "collecting_logs",
            f"Fetched {len(normalized)} events from Sentry:")
    for i, ev in enumerate(normalized, 1):
        lvl = ev["level"].upper()
        ts = ev["timestamp"] or "?"
        msg = ev["message"] or ev["title"] or "(no message)"
        txn = ev.get("transaction", "")
        eid = ev.get("event_id", "?")[:12]

        em.emit(A, EVENT_PROGRESS, "collecting_logs",
                f"  [{i:>2}] [{lvl:<7}] {ts}  {msg[:120]}")
        if txn:
            em.emit(A, EVENT_LOG, "collecting_logs",
                    f"       transaction: {txn}")

        # Show breadcrumbs if they exist (last 5 per event, only for events with them)
        breadcrumbs = ev.get("breadcrumbs", [])
        if breadcrumbs:
            em.emit(A, EVENT_LOG, "collecting_logs",
                    f"       breadcrumbs ({len(breadcrumbs)} total):")
            for bc in breadcrumbs[-5:]:
                bc_msg = bc.get("message", "") or ""
                bc_cat = bc.get("category", "")
                bc_ts = bc.get("timestamp", "")
                bc_lvl = bc.get("level", "")
                if bc_msg:
                    em.emit(A, EVENT_LOG, "collecting_logs",
                            f"         [{bc_lvl}] [{bc_cat}] {bc_msg[:100]}")

    em.emit(A, EVENT_PROGRESS, "collecting_logs",
            f"{'─' * 50}")

    # Filter to most relevant (keyword match + has content)
    keywords = [kw.lower() for kw in search_keywords.get("keywords", [])]
    scored = []
    for ev in normalized:
        text = (ev["message"] + " " + ev["title"] + " " + ev["transaction"]).lower()
        # Include breadcrumb text too
        for bc in ev.get("breadcrumbs", []):
            text += " " + (bc.get("message", "") or "").lower()

        score = sum(1 for kw in keywords if kw in text)
        # Always include errors/warnings
        if ev["level"] in ("error", "warning", "fatal"):
            score += 2
        scored.append((score, ev))

    # Sort by relevance (highest score first), take top N
    scored.sort(key=lambda x: x[0], reverse=True)
    relevant = [ev for score, ev in scored[:MAX_EVENTS_TO_ANALYZE] if score > 0 or ev["message"]]

    # Show which events were selected as relevant and why
    if relevant:
        em.emit(A, EVENT_PROGRESS, "collecting_logs",
                f"Top {len(relevant)} relevant events (ranked by keyword match):")
        for i, (score, ev) in enumerate(
            [(s, e) for s, e in scored[:MAX_EVENTS_TO_ANALYZE] if s > 0 or e["message"]][:10],
            1,
        ):
            msg = ev["message"] or ev["title"] or "(no message)"
            em.emit(A, EVENT_PROGRESS, "collecting_logs",
                    f"  [{i:>2}] score={score}  [{ev['level'].upper()}] {msg[:100]}")

    em.emit(A, EVENT_PROGRESS, "collecting_logs",
            f"Filtered to {len(relevant)} relevant events for analysis")

    return relevant


# ═══════════════════════════════════════════════════════════════════
#  STEP 3: LLM ANALYZES THE LOGS
# ═══════════════════════════════════════════════════════════════════

def _analyze_logs(
    issue_title: str,
    issue_body: str,
    triage_result: dict | None,
    logs: list[dict],
    model: str,
    em: EventEmitter | None = None,
) -> dict:
    """Feed collected logs to the LLM for analysis."""
    em = em or get_default_emitter()

    em.emit(A, EVENT_PROGRESS, "analyzing_logs",
            f"Analyzing {len(logs)} log entries with LLM...")

    # Build context
    context = f"Issue Title: {issue_title}\n"
    context += f"Issue Body: {issue_body or '(none)'}\n"
    if triage_result:
        context += f"Triage Severity: {triage_result.get('severity', 'unknown')}\n"
        context += f"Triage Module: {triage_result.get('likely_module', 'unknown')}\n"
        context += f"Triage Summary: {triage_result.get('summary', '')}\n"

    # Build log text
    logs_text = ""
    for i, ev in enumerate(logs, 1):
        logs_text += f"\n{'─' * 50}\n"
        logs_text += f"Event #{i}  (id={ev['event_id']})\n"
        logs_text += f"  Timestamp:   {ev['timestamp']}\n"
        logs_text += f"  Level:       {ev['level']}\n"
        logs_text += f"  Message:     {ev['message']}\n"
        if ev.get("transaction"):
            logs_text += f"  Transaction: {ev['transaction']}\n"
        if ev.get("tags"):
            logs_text += f"  Tags:        {json.dumps(ev['tags'], default=str)}\n"

        # Include breadcrumbs (last 10 per event)
        if ev.get("breadcrumbs"):
            logs_text += "  Breadcrumbs:\n"
            for bc in ev["breadcrumbs"][-10:]:
                msg = bc.get("message", "")
                cat = bc.get("category", "")
                ts = bc.get("timestamp", "")
                lvl = bc.get("level", "")
                logs_text += f"    [{ts}] [{lvl}] [{cat}] {msg}\n"
                if bc.get("data"):
                    logs_text += f"      data={json.dumps(bc['data'], default=str)[:200]}\n"

    analysis_prompt = (
        f"{context}\n\n"
        f"Below are {len(logs)} log entries from the Sentry project:\n"
        f"{logs_text}\n\n"
        f"Analyze these logs for suspicious activity related to the bug. "
        f"Focus on entries that show the bug's behavior in action."
    )

    try:
        raw = call_llm(LOG_ANALYSIS_SYSTEM_PROMPT, analysis_prompt, model)
    except Exception as e:
        em.emit(A, EVENT_ERROR, "analyzing_logs", f"LLM error: {e}")
        return {
            "suspicious_logs": [],
            "patterns_found": [],
            "timeline": "Analysis failed",
            "confidence": "low",
        }

    # Parse JSON
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        import re
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start >= 0 and end > start:
            fixed = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', raw[start:end])
            try:
                result = json.loads(fixed)
            except json.JSONDecodeError:
                em.emit(A, EVENT_ERROR, "analyzing_logs", "Failed to parse LLM response")
                result = {}
        else:
            result = {}

    # Ensure expected fields
    result.setdefault("suspicious_logs", [])
    result.setdefault("patterns_found", [])
    result.setdefault("timeline", "")
    result.setdefault("confidence", "medium")

    em.emit(A, EVENT_PROGRESS, "analyzing_logs",
            f"Found {len(result['suspicious_logs'])} suspicious entries, "
            f"{len(result['patterns_found'])} patterns")

    return result


# ═══════════════════════════════════════════════════════════════════
#  MAIN ENTRY POINT
# ═══════════════════════════════════════════════════════════════════

def analyze_logs(
    issue_title: str,
    issue_body: str,
    triage_result: dict | None = None,
    search_result: dict | None = None,
    model: str | None = None,
    emitter: EventEmitter | None = None,
) -> dict:
    """Run the Log Analysis Agent.

    Queries Sentry for traces/logs related to the bug, then uses the LLM
    to identify suspicious entries and patterns.

    Args:
        issue_title: The bug/issue title.
        issue_body: The bug/issue description.
        triage_result: Optional output from the triage agent.
        search_result: Optional output from the codebase search agent.
        model: LLM model to use.
        emitter: Optional event emitter for status updates.

    Returns:
        Structured log analysis report as a dict.
    """
    em = emitter or get_default_emitter()
    model = model or get_default_model()

    em.emit(A, EVENT_STATUS, "starting",
            "═" * 58)
    em.emit(A, EVENT_STATUS, "starting",
            "  LOG ANALYSIS AGENT — Starting log investigation")
    em.emit(A, EVENT_STATUS, "starting",
            "═" * 58)
    em.emit(A, EVENT_STATUS, "starting", "Log Analysis Agent starting", {
        "issue_title": issue_title,
    })

    # ── Check Sentry config ──────────────────────────────────────
    config = _get_sentry_config()
    if not config:
        em.emit(A, EVENT_ERROR, "config",
                "Sentry not configured. Set SENTRY_AUTH_TOKEN, SENTRY_ORG, "
                "SENTRY_PROJECT in your .env file.")
        return {
            "suspicious_logs": [],
            "patterns_found": [],
            "timeline": "Sentry not configured — log analysis skipped.",
            "confidence": "none",
            "total_events_scanned": 0,
            "error": "SENTRY_AUTH_TOKEN, SENTRY_ORG, or SENTRY_PROJECT not set",
        }

    em.emit(A, EVENT_PROGRESS, "config",
            f"✓ Sentry configured (org={config['org']}, project={config['project']})")

    # ── Step 1: Generate search keywords ─────────────────────────
    em.emit(A, EVENT_STATUS, "generating_keywords",
            "STEP 1/3: Generating search keywords")

    search_keywords = _generate_search_keywords(
        issue_title, issue_body, triage_result, model, em,
    )

    # ── Step 2: Collect logs from Sentry ─────────────────────────
    em.emit(A, EVENT_STATUS, "collecting_logs",
            "STEP 2/3: Querying Sentry for relevant logs")

    logs = _collect_sentry_logs(config, search_keywords, em)

    if not logs:
        em.emit(A, EVENT_PROGRESS, "collecting_logs",
                "No relevant log entries found in Sentry")
        return {
            "suspicious_logs": [],
            "patterns_found": [],
            "timeline": "No relevant log entries found in Sentry.",
            "confidence": "low",
            "total_events_scanned": 0,
            "search_keywords": search_keywords,
        }

    # ── Step 3: LLM analyzes the logs ────────────────────────────
    em.emit(A, EVENT_STATUS, "analyzing_logs",
            "STEP 3/3: Analyzing logs for suspicious activity")

    analysis = _analyze_logs(
        issue_title, issue_body, triage_result, logs, model, em,
    )

    analysis["total_events_scanned"] = len(logs)
    analysis["search_keywords"] = search_keywords

    # ── Result ────────────────────────────────────────────────────
    em.emit(A, EVENT_RESULT, "complete",
            "Log analysis complete", {
                "suspicious_count": len(analysis.get("suspicious_logs", [])),
                "patterns_count": len(analysis.get("patterns_found", [])),
                "confidence": analysis.get("confidence", "unknown"),
                "events_scanned": analysis["total_events_scanned"],
            })

    # ── Summary for frontend ─────────────────────────────────────
    suspicious = analysis.get("suspicious_logs", [])
    summary_findings = []
    for entry in suspicious[:5]:
        msg = entry.get("message", "")[:80]
        why = entry.get("why_suspicious", "")[:80]
        summary_findings.append(f"{msg} — {why}")

    em.emit(A, EVENT_SUMMARY, "summary",
            "Log Analysis Summary", {
                "confidence": analysis.get("confidence", "unknown"),
                "events_scanned": analysis["total_events_scanned"],
                "suspicious_logs": len(suspicious),
                "patterns_found": len(analysis.get("patterns_found", [])),
                "findings": summary_findings + analysis.get("patterns_found", []),
                "timeline": analysis.get("timeline", "")[:200],
            })

    em.emit(A, EVENT_STATUS, "complete",
            "═" * 58)
    em.emit(A, EVENT_STATUS, "complete",
            "  LOG ANALYSIS AGENT — Investigation complete")
    em.emit(A, EVENT_STATUS, "complete",
            "═" * 58)

    return analysis

