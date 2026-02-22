"""
Open-ended BugPilot pipeline runner (no built-in scenario dependency).

Usage:
  cd backend/agents
  source venv/bin/activate

  python example/run_open_issue.py \
    --title "Refund uses current product price instead of price-at-purchase" \
    --body "...full bug description..." \
    --repo-url "https://github.com/yaojiejia/buildathon_example_2" \
    --repo-name "yaojiejia/buildathon_example_2" \
    --enable-patch-agent
"""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

from pipeline import pipeline
from llm import get_default_model, DEFAULT_ANTHROPIC_MODEL
from events import ConsoleEventEmitter


BUSINESS_CASE_DIR = str(Path(__file__).resolve().parent.parent.parent.parent / "business_case")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run BugPilot with arbitrary issue title/body")
    parser.add_argument("--title", type=str, required=True, help="Issue title")
    parser.add_argument("--body", type=str, required=True, help="Issue body/description")
    parser.add_argument("--repo-url", type=str, default=None,
                        help="Remote git repo URL (if not set, uses local business_case/)")
    parser.add_argument("--repo-name", type=str, default="", help="Repo name (owner/repo)")
    parser.add_argument("--model", type=str, default=None, help="LLM model")
    parser.add_argument("--use-claude", action="store_true", help="Use Anthropic Claude")
    parser.add_argument("--claude-model", type=str, default=None,
                        help=f"Claude model override (default: ANTHROPIC_MODEL or {DEFAULT_ANTHROPIC_MODEL})")
    parser.add_argument("--num-questions", type=int, default=1,
                        help="Number of investigation questions for codebase search (1-10)")
    parser.add_argument("--slack-source", type=str, default=None,
                        help="Optional Nia data source name/id for Slack message search")
    parser.add_argument("--enable-patch-agent", action="store_true",
                        help="Run patch generation agent")
    args = parser.parse_args()

    model = args.model or get_default_model()
    if args.use_claude:
        model = args.claude_model or os.environ.get("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)

    from llm import get_provider, PROVIDER_NVIDIA, PROVIDER_ANTHROPIC
    configured_provider = get_provider()
    model_lower = model.lower()
    if model_lower.startswith("claude") or model_lower.startswith("anthropic"):
        provider = PROVIDER_ANTHROPIC
    elif model_lower.startswith("nvidia/") or model_lower.startswith("meta/") or model_lower.startswith("mistralai/"):
        provider = PROVIDER_NVIDIA
    else:
        provider = configured_provider

    if provider == PROVIDER_NVIDIA and not os.environ.get("NVIDIA_API_KEY"):
        print("Error: NVIDIA_API_KEY not set.", file=sys.stderr)
        sys.exit(1)
    if provider == PROVIDER_ANTHROPIC and not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY not set.", file=sys.stderr)
        sys.exit(1)

    use_local = args.repo_url is None
    repo_url = args.repo_url or BUSINESS_CASE_DIR

    emitter = ConsoleEventEmitter()

    print()
    print("=" * 60)
    print("  BugPilot Open-Ended Pipeline")
    print("=" * 60)
    print(f"  Issue:    {args.title}")
    print(f"  Source:   {repo_url}")
    if args.repo_name:
        print(f"  Repo:     {args.repo_name}")
    if args.enable_patch_agent:
        print("  Patch:    ENABLED")
    print(f"  Questions:{args.num_questions}")
    print(f"  Provider: {provider}")
    print(f"  Model:    {model}")
    print("=" * 60)
    print()

    input_state = {
        "issue_title": args.title,
        "issue_body": args.body,
        "repo_name": args.repo_name,
        "model": model,
        "num_questions": max(1, min(args.num_questions, 10)),
        "emitter": emitter,
    }

    if use_local:
        input_state["repo_url"] = BUSINESS_CASE_DIR
        input_state["clone_dir"] = BUSINESS_CASE_DIR
    else:
        input_state["repo_url"] = repo_url

    if args.slack_source:
        input_state["slack_source"] = args.slack_source
    if args.enable_patch_agent:
        input_state["enable_patch_agent"] = True

    result = pipeline.invoke(input_state)
    report = result.get("report", {})

    print()
    print("=" * 60)
    print("  FINAL REPORT (JSON)")
    print("=" * 60)
    print(json.dumps(report, indent=2))

    output_path = Path(__file__).resolve().parent / "last_open_report.json"
    output_path.write_text(json.dumps(report, indent=2))
    print(f"\nReport saved to: {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
