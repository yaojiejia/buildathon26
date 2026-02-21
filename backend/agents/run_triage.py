"""
CLI runner for the Triage Agent.

Usage:
  # With arguments:
  python run_triage.py --title "Login page crashes on mobile" --body "When I tap login on iOS Safari, the page goes blank..."

  # Interactive (prompts for input):
  python run_triage.py

  # Pipe in JSON:
  echo '{"title": "Bug title", "body": "Bug description"}' | python run_triage.py --stdin
"""

import argparse
import json
import sys
import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from agents/ dir or parent backend/ dir
load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from triage_agent import triage_issue


def main():
    parser = argparse.ArgumentParser(description="Run the BugPilot Triage Agent")
    parser.add_argument("--title", type=str, help="Issue title")
    parser.add_argument("--body", type=str, help="Issue body/description")
    parser.add_argument("--repo", type=str, default="", help="Repository name (optional)")
    parser.add_argument("--stdin", action="store_true", help="Read JSON input from stdin")
    parser.add_argument("--model", type=str, default="claude-sonnet-4-20250514", help="Claude model to use")
    args = parser.parse_args()

    # ── Get issue data ───────────────────────────────────────────
    if args.stdin:
        data = json.load(sys.stdin)
        title = data["title"]
        body = data.get("body", "")
        repo = data.get("repo", args.repo)
    elif args.title:
        title = args.title
        body = args.body or ""
        repo = args.repo
    else:
        # Interactive mode
        print("=== BugPilot Triage Agent ===\n")
        title = input("Issue title: ").strip()
        body = input("Issue body (one line, or 'none'): ").strip()
        if body.lower() == "none":
            body = ""
        repo = input("Repo name (optional, press enter to skip): ").strip()

    if not title:
        print("Error: issue title is required", file=sys.stderr)
        sys.exit(1)

    # ── Verify API key ───────────────────────────────────────────
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY not set. Add it to backend/.env or export it.", file=sys.stderr)
        sys.exit(1)

    # ── Run triage ───────────────────────────────────────────────
    print(f"\nTriaging: \"{title}\"...\n", file=sys.stderr)

    result = triage_issue(
        issue_title=title,
        issue_body=body,
        repo_name=repo,
        model=args.model,
    )

    # ── Output structured JSON ───────────────────────────────────
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

