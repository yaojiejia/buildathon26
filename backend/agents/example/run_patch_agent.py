"""
Patch-only runner for BugPilot.

Runs only the Patch Generation Agent so you can quickly test/fix a repo
without executing the full pipeline.

Usage:
  cd backend/agents
  source venv/bin/activate

  python example/run_patch_agent.py \
    --repo-url "https://github.com/yaojiejia/buildathon_example_2" \
    --repo-name "yaojiejia/buildathon_example_2" \
    --scenario refund_wrong_amount \
    --model meta/llama-3.1-405b-instruct

You can also feed prior context (triage/search/doc/log) from a report JSON:
  python example/run_patch_agent.py ... --report-json example/last_report.json
"""

import argparse
import json
import os
import sys
from pathlib import Path

# Add agents/ to the path so we can import patch agent modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

# Load .env from backend/
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

from llm import (
    get_default_model,
    get_provider,
    PROVIDER_NVIDIA,
    PROVIDER_ANTHROPIC,
    DEFAULT_ANTHROPIC_MODEL,
)
from patch_agent import generate_patch
from events import ConsoleEventEmitter


BUSINESS_CASE_DIR = str(Path(__file__).resolve().parent.parent.parent.parent / "business_case")

SCENARIOS = {
    "refund_wrong_amount": {
        "title": "Refund uses current product price instead of price-at-purchase",
        "body": (
            "The process_refund function in services.py recalculates the refund "
            "amount by looking up each product's CURRENT price and multiplying by "
            "quantity. But the order stores price_at_purchase in order_items. "
            "If a product's price has changed since the order was placed, the "
            "refund amount will be wrong. The docstring says 'refund amount should "
            "be the TOTAL that the customer actually paid' (order.total), but the "
            "code ignores order.total entirely."
        ),
    },
    "discount_stacking": {
        "title": "Discount stacking bug — loyalty + promo code applied together instead of best-of",
        "body": (
            "When a Gold-tier customer (10% loyalty discount) uses a promo code "
            "(e.g. SAVE10 for 10%), both discounts are applied sequentially instead "
            "of picking the larger one. The business rule says apply whichever "
            "discount is larger, not both."
        ),
    },
}


def _load_report(path: str) -> dict:
    p = Path(path)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except Exception:
        return {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Run patch generation agent only")
    parser.add_argument("--scenario", type=str, default="refund_wrong_amount",
                        choices=list(SCENARIOS.keys()),
                        help="Built-in issue scenario")
    parser.add_argument("--title", type=str, default=None, help="Custom issue title (overrides scenario)")
    parser.add_argument("--body", type=str, default=None, help="Custom issue body (overrides scenario)")
    parser.add_argument("--repo-url", type=str, default=None,
                        help="Remote git repo URL (if omitted, uses local business_case/)")
    parser.add_argument("--repo-name", type=str, default="", help="Repo name, e.g. owner/repo")
    parser.add_argument("--clone-dir", type=str, default=None,
                        help="Optional existing local repo directory to patch")
    parser.add_argument("--model", type=str, default=None,
                        help="LLM model to use for patch generation")
    parser.add_argument("--use-claude", action="store_true",
                        help="Use Anthropic Claude for this patch run")
    parser.add_argument("--claude-model", type=str, default=None,
                        help=f"Claude model override (default: ANTHROPIC_MODEL or {DEFAULT_ANTHROPIC_MODEL})")
    parser.add_argument("--report-json", type=str, default="example/last_report.json",
                        help="Prior report JSON to reuse triage/search/doc/log context")
    args = parser.parse_args()

    scenario = SCENARIOS[args.scenario]
    title = args.title or scenario["title"]
    body = args.body or scenario["body"]
    model = args.model or get_default_model()
    if args.use_claude:
        model = args.claude_model or os.environ.get("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)

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

    report = _load_report(args.report_json)
    triage = report.get("triage", {})
    search = report.get("investigation", {})
    docs = report.get("documentation", {})
    logs = report.get("log_analysis", {})

    use_local = args.repo_url is None
    repo_url = args.repo_url or BUSINESS_CASE_DIR
    clone_dir = args.clone_dir or (BUSINESS_CASE_DIR if use_local else None)

    emitter = ConsoleEventEmitter()

    print()
    print("=" * 60)
    print("  BugPilot Patch Runner")
    print("=" * 60)
    print(f"  Issue:    {title}")
    print(f"  Source:   {repo_url}")
    if args.repo_name:
        print(f"  Repo:     {args.repo_name}")
    if clone_dir:
        print(f"  CloneDir: {clone_dir}")
    print(f"  Provider: {provider}")
    print(f"  Model:    {model}")
    print(f"  Context:  report={args.report_json} triage={bool(triage)} search={bool(search)} docs={bool(docs)} logs={bool(logs)}")
    print("=" * 60)
    print()

    result = generate_patch(
        issue_title=title,
        issue_body=body,
        repo_url=repo_url,
        repo_name=args.repo_name,
        triage_result=triage,
        search_result=search,
        doc_result=docs,
        log_result=logs,
        model=model,
        clone_dir=clone_dir,
        emitter=emitter,
    )

    print()
    print("=" * 60)
    print("  PATCH RESULT (JSON)")
    print("=" * 60)
    print(json.dumps(result, indent=2))

    output_path = Path(__file__).resolve().parent / "last_patch_result.json"
    output_path.write_text(json.dumps(result, indent=2))
    print(f"\nPatch result saved to: {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
