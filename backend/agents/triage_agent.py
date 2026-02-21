"""
Triage Agent — classifies GitHub issues using Claude API.

Takes a GitHub issue (title + body) and returns structured JSON:
  - severity: critical | high | medium | low
  - likely_module: which part of the codebase is affected
  - is_duplicate: whether this looks like a known/duplicate issue
  - duplicate_of: description of the suspected original (if duplicate)
  - summary: ≤5-line Slack-ready summary
"""

import json
import anthropic


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
    model: str = "claude-sonnet-4-20250514",
) -> dict:
    """Run the triage agent on a GitHub issue.

    Args:
        issue_title: The GitHub issue title.
        issue_body: The GitHub issue body/description.
        repo_name: Optional repo name for context.
        existing_issues: Optional list of existing issue titles for duplicate detection.
        model: Claude model to use.

    Returns:
        Structured triage result as a dict.
    """
    client = anthropic.Anthropic()

    # Build the user message with all available context
    user_message = f"Issue Title: {issue_title}\n\n"
    user_message += f"Issue Body:\n{issue_body or '(no description provided)'}\n"

    if repo_name:
        user_message += f"\nRepository: {repo_name}\n"

    if existing_issues:
        user_message += "\nExisting open issues (for duplicate detection):\n"
        for i, title in enumerate(existing_issues[:20], 1):  # cap at 20
            user_message += f"  {i}. {title}\n"

    response = client.messages.create(
        model=model,
        max_tokens=1024,
        system=TRIAGE_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    # Extract the text response
    raw_text = response.content[0].text.strip()

    # Parse JSON (strip markdown fences if model adds them despite instructions)
    if raw_text.startswith("```"):
        raw_text = raw_text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    result = json.loads(raw_text)

    # Validate expected fields
    expected_keys = {"severity", "likely_module", "is_duplicate", "duplicate_of", "summary"}
    missing = expected_keys - set(result.keys())
    if missing:
        raise ValueError(f"Triage response missing fields: {missing}")

    return result

