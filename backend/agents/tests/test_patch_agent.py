import json
import os
import subprocess
from pathlib import Path

import pytest

from patch_agent import generate_patch


def _init_git_repo(repo_dir: Path) -> None:
    import subprocess

    def run(*args: str) -> None:
        subprocess.run(args, cwd=repo_dir, check=True, capture_output=True, text=True)

    run("git", "init")
    run("git", "config", "user.email", "test@example.com")
    run("git", "config", "user.name", "Patch Agent Test")
    run("git", "add", "-A")
    run("git", "commit", "-m", "initial")


def test_patch_generation_makes_real_changes(monkeypatch, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()

    # Minimal bug-relevant codebase
    services = repo / "services.py"
    services.write_text(
        "def process_refund(order):\n"
        "    refund_amount = 0.0\n"
        "    for item in order.items:\n"
        "        refund_amount += item.product.price * item.quantity\n"
        "    return refund_amount\n"
    )
    (repo / "models.py").write_text(
        "class OrderItem:\n"
        "    def __init__(self, product, quantity, price_at_purchase):\n"
        "        self.product = product\n"
        "        self.quantity = quantity\n"
        "        self.price_at_purchase = price_at_purchase\n"
    )
    _init_git_repo(repo)

    patch_payload = {
        "branch_name_hint": "refund-fix",
        "commit_title": "fix: use price_at_purchase for refunds",
        "pr_title": "fix: refund calculation uses purchase-time price",
        "pr_body_markdown": "## Summary\n- Fix refund logic\n- Add regression test",
        "changes": [
            {
                "file_path": "services.py",
                "action": "update",
                "summary": "Use price_at_purchase in refund calculation",
                "content": (
                    "def process_refund(order):\n"
                    "    refund_amount = 0.0\n"
                    "    for item in order.items:\n"
                    "        refund_amount += item.price_at_purchase * item.quantity\n"
                    "    return refund_amount\n"
                ),
            }
        ],
        "tests": [
            {
                "file_path": "tests/test_refund.py",
                "action": "create",
                "summary": "Regression test for refund calculation",
                "content": (
                    "def test_refund_uses_price_at_purchase():\n"
                    "    class P: \n"
                    "        def __init__(self, price): self.price = price\n"
                    "    class I:\n"
                    "        def __init__(self, product, quantity, price_at_purchase):\n"
                    "            self.product = product\n"
                    "            self.quantity = quantity\n"
                    "            self.price_at_purchase = price_at_purchase\n"
                    "    class O:\n"
                    "        def __init__(self, items): self.items = items\n"
                    "    from services import process_refund\n"
                    "    order = O([I(P(99.0), 2, 30.0)])\n"
                    "    assert process_refund(order) == 60.0\n"
                ),
            }
        ],
    }

    # Mock external effects so the unit test stays local/offline.
    monkeypatch.setattr("patch_agent.call_llm", lambda *args, **kwargs: json.dumps(patch_payload))
    monkeypatch.setattr("patch_agent._push_branch", lambda *args, **kwargs: {"status": "pushed"})
    monkeypatch.setattr(
        "patch_agent._create_draft_pr",
        lambda *args, **kwargs: {"status": "created", "url": "https://example.test/pr/1"},
    )

    result = generate_patch(
        issue_title="Refund uses current product price instead of price-at-purchase",
        issue_body="Refund should use purchase-time values.",
        repo_url=str(repo),
        repo_name="owner/repo",
        triage_result={"severity": "high", "summary": "refund bug"},
        search_result={
            "suspect_files": [{"file_path": "services.py"}],
            "reasoning": "process_refund uses current price",
        },
        doc_result={},
        log_result={},
        model="llama-3.1-405b-instruct",
        clone_dir=str(repo),
    )

    assert result["status"] == "ok"
    assert "services.py" in result["changed_files"]
    assert result["commit_sha"]
    assert result["draft_pr"]["status"] == "created"


def _gh_ready() -> bool:
    """Check whether gh CLI exists and is authenticated."""
    try:
        ver = subprocess.run(["gh", "--version"], capture_output=True, text=True)
        if ver.returncode != 0:
            return False
        auth = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True)
        return auth.returncode == 0
    except FileNotFoundError:
        return False


@pytest.mark.skipif(
    os.environ.get("PATCH_AGENT_RUN_REMOTE_E2E") != "1",
    reason="Set PATCH_AGENT_RUN_REMOTE_E2E=1 to run remote push/PR integration test.",
)
def test_patch_generation_opens_real_pr(monkeypatch):
    """
    Optional integration test.

    This test does REAL operations:
    - creates a branch
    - commits code
    - pushes to origin
    - opens a draft PR via gh

    Required env vars:
      PATCH_AGENT_E2E_REPO_URL
      PATCH_AGENT_E2E_REPO_NAME
    """
    repo_url = os.environ.get("PATCH_AGENT_E2E_REPO_URL", "").strip()
    repo_name = os.environ.get("PATCH_AGENT_E2E_REPO_NAME", "").strip()
    if not repo_url or not repo_name:
        pytest.skip("PATCH_AGENT_E2E_REPO_URL and PATCH_AGENT_E2E_REPO_NAME are required.")
    if not _gh_ready():
        pytest.skip("gh CLI missing or not authenticated.")

    # Deterministic patch payload so the test exercises branch/push/PR flow.
    patch_payload = {
        "branch_name_hint": "refund-fix-e2e",
        "commit_title": "fix: use price_at_purchase in process_refund",
        "pr_title": "fix: refund uses price_at_purchase",
        "pr_body_markdown": "## Summary\n- Fix refund calculation\n- Add regression test",
        "changes": [
            {
                "file_path": "services.py",
                "action": "update",
                "summary": "Use purchase-time price",
                "content": (
                    "from sqlalchemy.orm import Session\n"
                    "from models import Product, Customer, Order, OrderItem, PromoCode\n\n"
                    "# patched by integration test\n"
                    "def process_refund(db: Session, order_id: int) -> dict:\n"
                    "    order = db.query(Order).filter(Order.id == order_id).first()\n"
                    "    if not order:\n"
                    "        raise ValueError('Order not found')\n"
                    "    if order.status == 'refunded':\n"
                    "        raise ValueError('Order already refunded')\n\n"
                    "    refund_amount = 0.0\n"
                    "    for item in order.items:\n"
                    "        refund_amount += item.price_at_purchase * item.quantity\n"
                    "        product = db.query(Product).filter(Product.id == item.product_id).first()\n"
                    "        if product:\n"
                    "            product.stock += item.quantity\n\n"
                    "    customer = order.customer\n"
                    "    customer.loyalty_points = max(0, customer.loyalty_points - int(refund_amount))\n"
                    "    order.status = 'refunded'\n"
                    "    order.refund_amount = round(refund_amount, 2)\n"
                    "    db.commit()\n"
                    "    return {'order_id': order.id, 'refund_amount': round(refund_amount, 2), 'status': 'refunded'}\n"
                ),
            }
        ],
        "tests": [
            {
                "file_path": "tests/test_services_refund_e2e.py",
                "action": "create",
                "summary": "Smoke test file created by integration test",
                "content": (
                    "def test_placeholder_refund_patch_e2e():\n"
                    "    assert True\n"
                ),
            }
        ],
    }

    monkeypatch.setattr("patch_agent.call_llm", lambda *args, **kwargs: json.dumps(patch_payload))

    result = generate_patch(
        issue_title="Refund uses current product price instead of price-at-purchase",
        issue_body="Fix process_refund to use price_at_purchase.",
        repo_url=repo_url,
        repo_name=repo_name,
        triage_result={"severity": "high", "summary": "refund bug"},
        search_result={"suspect_files": [{"file_path": "services.py"}], "reasoning": "refund bug in services.py"},
        doc_result={},
        log_result={},
        model=os.environ.get("PATCH_AGENT_E2E_MODEL", "llama-3.1-405b-instruct"),
    )

    assert result.get("branch", "").startswith("bugpilot/")
    assert result.get("push_branch", {}).get("status") == "pushed"
    assert result.get("draft_pr", {}).get("status") == "created"
