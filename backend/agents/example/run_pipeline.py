"""
Example runner — tests the full Triage → Codebase Search pipeline.

Usage:
  cd backend/agents
  source venv/bin/activate

  # Test with the built-in business_case app (local, no cloning):
  python example/run_pipeline.py

  # Test with a remote GitHub repo (uses Nia if NIA_API_KEY is set):
  python example/run_pipeline.py \
    --repo-url "https://github.com/yaojiejia/buildathon_example" \
    --repo-name "yaojiejia/buildathon_example"

  # Custom issue:
  python example/run_pipeline.py \
    --title "Login crashes on mobile" \
    --body "Blank page on iOS Safari when tapping login button" \
    --repo-url "https://github.com/your-org/your-repo.git" \
    --repo-name "your-org/your-repo"
"""

import argparse
import json
import os
import sys
from pathlib import Path

# Add agents/ to the path so we can import pipeline
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

# Load .env from backend/ dir
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

from pipeline import pipeline
from events import ConsoleEventEmitter


# ── Built-in test scenarios using the business_case app ───────────

BUSINESS_CASE_DIR = str(Path(__file__).resolve().parent.parent.parent.parent / "business_case")

SCENARIOS = {
    "discount_stacking": {
        "title": "Discount stacking bug — loyalty + promo code applied together instead of best-of",
        "body": (
            "When a Gold-tier customer (10% loyalty discount) uses a promo code "
            "(e.g. SAVE10 for 10%), both discounts are applied sequentially instead "
            "of picking the larger one. The business rule in the docstring says "
            "'apply whichever discount is LARGER (not both)' but the code applies "
            "the loyalty discount first, then the promo code on the reduced amount. "
            "For a $100 order with Gold tier + SAVE10, the customer pays $81.00 "
            "instead of the correct $90.00."
        ),
    },
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
    "both_bugs": {
        "title": "Multiple business logic issues in order and refund system",
        "body": (
            "Two business logic problems have been reported:\n\n"
            "1. DISCOUNT BUG: Gold-tier customers using promo codes get double "
            "discounts. The code applies loyalty discount first, then promo on "
            "the reduced subtotal, instead of picking the larger discount.\n\n"
            "2. REFUND BUG: Refunds are calculated using the product's current "
            "price instead of the price_at_purchase stored in order_items. If "
            "prices change, refund amounts are incorrect. The code also ignores "
            "the order.total field completely.\n\n"
            "Both bugs are in services.py."
        ),
    },
}

DEFAULT_SCENARIO = "both_bugs"


def main():
    parser = argparse.ArgumentParser(description="Run the BugPilot investigation pipeline")
    parser.add_argument("--scenario", type=str, default=DEFAULT_SCENARIO,
                        choices=list(SCENARIOS.keys()),
                        help=f"Built-in test scenario (default: {DEFAULT_SCENARIO})")
    parser.add_argument("--title", type=str, default=None, help="Custom issue title (overrides scenario)")
    parser.add_argument("--body", type=str, default=None, help="Custom issue body (overrides scenario)")
    parser.add_argument("--repo-url", type=str, default=None,
                        help="Remote git repo URL (if not set, uses local business_case/)")
    parser.add_argument("--repo-name", type=str, default="shopeasy/order-mgmt", help="Repo name")
    parser.add_argument("--model", type=str, default="claude-sonnet-4-20250514", help="Claude model")
    parser.add_argument("--list-scenarios", action="store_true", help="List available test scenarios")
    args = parser.parse_args()

    if args.list_scenarios:
        print("Available test scenarios:\n")
        for name, s in SCENARIOS.items():
            print(f"  {name}")
            print(f"    {s['title']}\n")
        return

    # ── Pick scenario or custom input ────────────────────────────
    scenario = SCENARIOS[args.scenario]
    title = args.title or scenario["title"]
    body = args.body or scenario["body"]

    # ── Verify API key ───────────────────────────────────────────
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY not set.", file=sys.stderr)
        print("Add it to backend/.env or: export ANTHROPIC_API_KEY=sk-ant-...", file=sys.stderr)
        sys.exit(1)

    # ── Determine if using local app or remote repo ──────────────
    use_local = args.repo_url is None

    # ── Create event emitter ─────────────────────────────────────
    emitter = ConsoleEventEmitter()

    # ── Header ───────────────────────────────────────────────────
    print()
    print("=" * 60)
    print("  BugPilot Investigation Pipeline")
    print("=" * 60)
    print(f"  Scenario: {args.scenario}")
    print(f"  Issue:    {title}")
    if use_local:
        print(f"  Source:   local ({BUSINESS_CASE_DIR})")
    else:
        print(f"  Source:   {args.repo_url}")
    print(f"  Model:    {args.model}")
    print("=" * 60)
    print()

    # ── Build pipeline input ─────────────────────────────────────
    input_state = {
        "issue_title": title,
        "issue_body": body,
        "repo_name": args.repo_name,
        "model": args.model,
        "emitter": emitter,
    }

    if use_local:
        input_state["repo_url"] = BUSINESS_CASE_DIR
        input_state["clone_dir"] = BUSINESS_CASE_DIR
    else:
        input_state["repo_url"] = args.repo_url

    # ── Run the pipeline ─────────────────────────────────────────
    result = pipeline.invoke(input_state)

    # ── Output the final report ──────────────────────────────────
    report = result.get("report", {})

    print()
    print("=" * 60)
    print("  FINAL REPORT (JSON)")
    print("=" * 60)
    print(json.dumps(report, indent=2))

    # ── Also save to file ────────────────────────────────────────
    output_path = Path(__file__).resolve().parent / "last_report.json"
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nReport saved to: {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
