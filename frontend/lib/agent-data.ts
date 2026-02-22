import { AgentEvent, AgentId, BugReport, InvestigationReport } from "./types"

// ─── The bug we're investigating ─────────────────────────────
export const bugReport: BugReport = {
  id: "GH-101",
  title: "Refund uses current product price instead of price-at-purchase",
  repo: "yaojiejia/buildathon_example_2",
  author: "yaojiejia",
  severity: "high",
  summary:
    "The process_refund function in services.py recalculates the refund amount by looking up each product's CURRENT price and multiplying by quantity. But the order stores price_at_purchase in order_items. If a product's price has changed since the order was placed, the refund amount will be wrong. The docstring says 'refund amount should be the TOTAL that the customer actually paid' (order.total), but the code ignores order.total entirely.",
  labels: ["bug", "payments", "refund", "business-logic"],
  createdAt: "2026-02-21T09:00:00Z",
}

let _id = 0
const id = () => `evt-${++_id}`

// ─── TRIAGE AGENT ────────────────────────────────────────────
export const triageEvents: AgentEvent[] = [
  {
    id: id(), agentId: "triage", type: "action", delay: 400,
    message: "Analyzing issue severity and affected module…",
  },
  {
    id: id(), agentId: "triage", type: "query", delay: 1200,
    message: "Classifying: \"Refund uses current product price instead of price-at-purchase\"",
    detail: "Evaluating severity, likely module, and checking for duplicates",
  },
  {
    id: id(), agentId: "triage", type: "result", delay: 1800,
    message: "Severity: HIGH — financial accuracy affected",
    detail: "likely_module: payments/refunds\nis_duplicate: No",
  },
  {
    id: id(), agentId: "triage", type: "finding", delay: 1000,
    message: "Refund system uses current prices instead of price_at_purchase — affects revenue and customer trust",
  },
  {
    id: id(), agentId: "triage", type: "complete", delay: 600,
    message: "Triage complete — HIGH severity, payments/refunds module",
  },
]

// ─── CODEBASE SEARCH AGENT (RAG) ────────────────────────────
export const codebaseSearchEvents: AgentEvent[] = [
  {
    id: id(), agentId: "codebase_search", type: "action", delay: 600,
    message: "Generating investigation questions for codebase search…",
  },
  {
    id: id(), agentId: "codebase_search", type: "query", delay: 2000,
    message: "Q1: Where is process_refund implemented and how does it calculate refund amounts?",
    detail: "Searching repository via Nia RAG",
  },
  {
    id: id(), agentId: "codebase_search", type: "result", delay: 1800,
    message: "Found process_refund in services.py at line 98",
    detail: "Function calculates refund by looking up current product prices with product.price * item.quantity instead of using item.price_at_purchase",
  },
  {
    id: id(), agentId: "codebase_search", type: "file_open", delay: 1600,
    message: "Opening services.py — process_refund function",
    detail: `def process_refund(db: Session, order_id: int) -> dict:
    """Process a full refund for an order.
    The refund amount should be the TOTAL that the customer
    actually paid at the time of purchase (order.total).
    """
    order = db.query(Order).filter(Order.id == order_id).first()
    refund_amount = 0.0
    for item in order.items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if product:
            refund_amount += product.price * item.quantity  # BUG: uses current price
            product.stock += item.quantity`,
  },
  {
    id: id(), agentId: "codebase_search", type: "finding", delay: 1400,
    message: "BUG: process_refund uses product.price (current) instead of item.price_at_purchase (historical)",
  },
  {
    id: id(), agentId: "codebase_search", type: "file_open", delay: 1200,
    message: "Opening models.py — OrderItem model",
    detail: `class OrderItem(Base):
    __tablename__ = "order_items"
    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    price_at_purchase = Column(Float, nullable=False)  # correct price stored here`,
  },
  {
    id: id(), agentId: "codebase_search", type: "query", delay: 1000,
    message: "Grep: price_at_purchase|order\\.total.*refund",
    detail: "3 matches found across services.py, routes.py, models.py",
  },
  {
    id: id(), agentId: "codebase_search", type: "result", delay: 1600,
    message: "price_at_purchase is correctly stored during order creation but ignored during refunds",
    detail: "services.py line 59: price_at_purchase=product.price (set at order time)\nmodels.py line 24: price_at_purchase = Column(Float, nullable=False)\nroutes.py: price_at_purchase exposed in API responses",
  },
  {
    id: id(), agentId: "codebase_search", type: "complete", delay: 800,
    message: "Codebase search complete — root cause identified in services.py line 98",
  },
]

// ─── DOC ANALYSIS AGENT ─────────────────────────────────────
export const docAnalysisEvents: AgentEvent[] = [
  {
    id: id(), agentId: "doc_analysis", type: "action", delay: 800,
    message: "Collecting markdown documentation from repository…",
  },
  {
    id: id(), agentId: "doc_analysis", type: "query", delay: 2000,
    message: "Searching for documentation related to refund system architecture…",
    detail: "Scanning README.md and any internal docs via Nia",
  },
  {
    id: id(), agentId: "doc_analysis", type: "result", delay: 2200,
    message: "Found 1 relevant document",
    detail: "1. README.md — Provides overview of refund system architecture",
  },
  {
    id: id(), agentId: "doc_analysis", type: "file_open", delay: 1600,
    message: "Reading README.md — system architecture overview",
    detail: `## Architecture
The system processes refunds through services.py.
Business logic: refund amounts should match what the customer paid.
The OrderItem model stores price_at_purchase for historical accuracy.`,
  },
  {
    id: id(), agentId: "doc_analysis", type: "finding", delay: 1200,
    message: "README confirms price_at_purchase should be used for refund calculations — code contradicts documentation",
  },
  {
    id: id(), agentId: "doc_analysis", type: "complete", delay: 1000,
    message: "Documentation analysis complete — architecture violation confirmed",
  },
]

// ─── LOG ANALYSIS AGENT ─────────────────────────────────────
export const logAnalysisEvents: AgentEvent[] = [
  {
    id: id(), agentId: "log_analysis", type: "action", delay: 400,
    message: "Connecting to Sentry for log analysis…",
  },
  {
    id: id(), agentId: "log_analysis", type: "query", delay: 1200,
    message: "Generating search keywords from issue context…",
    detail: "Keywords: process_refund, refund_amount, price_at_purchase, order.total",
  },
  {
    id: id(), agentId: "log_analysis", type: "result", delay: 1800,
    message: "Querying Sentry for events matching refund-related errors…",
    detail: "Searching for: process_refund errors, refund amount mismatches, price calculation issues",
  },
  {
    id: id(), agentId: "log_analysis", type: "error", delay: 1400,
    message: "⚠ Sentry not fully configured — limited log data available",
    detail: "Set SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT for full log analysis",
  },
  {
    id: id(), agentId: "log_analysis", type: "complete", delay: 1000,
    message: "Log analysis complete — Sentry configuration needed for deeper analysis",
  },
]

// ─── PATCH GENERATION AGENT ─────────────────────────────────
export const patchGenerationEvents: AgentEvent[] = [
  {
    id: id(), agentId: "patch_generation", type: "action", delay: 1000,
    message: "Building patch context from prior agent findings…",
  },
  {
    id: id(), agentId: "patch_generation", type: "action", delay: 2000,
    message: "Reading suspect files: services.py, models.py",
    detail: "Gathering context for code patch generation",
  },
  {
    id: id(), agentId: "patch_generation", type: "query", delay: 2400,
    message: "Asking LLM to generate fix patch…",
    detail: "Fix: Replace product.price with item.price_at_purchase in process_refund",
  },
  {
    id: id(), agentId: "patch_generation", type: "action", delay: 3000,
    message: "Generating patch for services.py",
    detail: `--- a/services.py
+++ b/services.py
@@ -98,7 +98,7 @@
     refund_amount = 0.0
     for item in order.items:
-        product = db.query(Product).filter(Product.id == item.product_id).first()
-        if product:
-            refund_amount += product.price * item.quantity
+        refund_amount += item.price_at_purchase * item.quantity
+        product = db.query(Product).filter(Product.id == item.product_id).first()
+        if product:
             product.stock += item.quantity`,
  },
  {
    id: id(), agentId: "patch_generation", type: "action", delay: 1800,
    message: "Creating branch: bugpilot/fix-refund-price-calculation",
  },
  {
    id: id(), agentId: "patch_generation", type: "success", delay: 1600,
    message: "✓ Patch generated — 1 file changed, fix uses price_at_purchase",
  },
  {
    id: id(), agentId: "patch_generation", type: "action", delay: 1200,
    message: "Creating draft PR: fix: use price_at_purchase for refunds instead of current prices",
  },
  {
    id: id(), agentId: "patch_generation", type: "complete", delay: 800,
    message: "Patch generation complete — PR created with fix",
  },
]

// ─── Export all events grouped by agent ──────────────────────
export const allAgentEvents: Record<AgentId, AgentEvent[]> = {
  triage: triageEvents,
  codebase_search: codebaseSearchEvents,
  doc_analysis: docAnalysisEvents,
  log_analysis: logAnalysisEvents,
  patch_generation: patchGenerationEvents,
}

// ─── Agent metadata ──────────────────────────────────────────
export const agentMeta: Record<AgentId, { name: string; icon: string; color: string; description: string }> = {
  triage: {
    name: "Triage Agent",
    icon: "Shield",
    color: "text-purple-400",
    description: "Classifies severity, identifies affected module, and detects duplicates",
  },
  codebase_search: {
    name: "Codebase Search",
    icon: "Search",
    color: "text-blue-400",
    description: "RAG-powered search across the repository to find relevant code",
  },
  doc_analysis: {
    name: "Doc Analysis",
    icon: "BookOpen",
    color: "text-emerald-400",
    description: "Analyzes repository documentation and Slack messages for context",
  },
  log_analysis: {
    name: "Log Analysis",
    icon: "ScrollText",
    color: "text-amber-400",
    description: "Queries Sentry for errors and log patterns related to the bug",
  },
  patch_generation: {
    name: "Patch Generation",
    icon: "Wrench",
    color: "text-cyan-400",
    description: "Generates code patches, creates branches, and opens draft PRs",
  },
}

// ─── Demo report (used when running in demo/mock mode) ───────
export const demoReport: InvestigationReport = {
  issue: {
    title: bugReport.title,
    body: bugReport.summary,
    repo: bugReport.repo,
  },
  triage: {
    severity: "high",
    likely_module: "payments/refunds",
    is_duplicate: false,
    duplicate_of: null,
    summary: "Refund system calculates wrong amounts by using current product prices instead of original purchase prices. When product prices change after purchase, customers get incorrect refund amounts. The code ignores the stored price_at_purchase field and order.total, contradicting its own documentation.",
  },
  investigation: {
    suspect_files: [
      {
        file_path: "services.py",
        why_relevant: "Contains the buggy process_refund function that calculates refund amounts using current product prices instead of the price_at_purchase stored in order items.",
        lines_referenced: [98],
        snippet: "refund_amount += product.price * item.quantity  # BUG: uses current price",
      },
      {
        file_path: "models.py",
        why_relevant: "Defines the OrderItem model with the price_at_purchase field that stores the correct price but is ignored by process_refund.",
        lines_referenced: [24],
        snippet: "price_at_purchase = Column(Float, nullable=False)",
      },
    ],
    reasoning: "The bug is in the process_refund function in services.py at line 98. The function documentation states that refunds should use 'the TOTAL that the customer actually paid', but the implementation calculates refunds by querying current product prices with 'product.price * item.quantity' instead of using the stored 'price_at_purchase' field from the OrderItem model.",
    confidence: "high",
    questions_asked: [
      "Where is process_refund implemented and how does it calculate refund amounts?",
      "How is price_at_purchase defined in the data models?",
    ],
    evidence_collected: [],
  },
  documentation: {
    relevant_docs: [
      {
        file_path: "README.md",
        why_relevant: "Provides overview of the refund system architecture and confirms refund processing logic is in services.py",
        key_sections: ["business logic", "services.py"],
      },
    ],
    reasoning: "README confirms price_at_purchase should be used for refund calculations.",
    confidence: "low",
    total_docs_scanned: 1,
    relevant_messages: [],
  },
  log_analysis: {
    suspicious_logs: [],
    patterns_found: [],
    timeline: "Sentry not configured — log analysis skipped.",
    confidence: "none",
    total_events_scanned: 0,
    error: "SENTRY_AUTH_TOKEN, SENTRY_ORG, or SENTRY_PROJECT not set",
  },
  patch_generation: {
    status: "ok",
    changed_files: ["services.py"],
    diff: "- refund_amount += product.price * item.quantity\n+ refund_amount += item.price_at_purchase * item.quantity",
    pr_title: "fix: use price_at_purchase for refunds instead of current prices",
    pr_body_markdown: "Fixed process_refund to use stored price_at_purchase values instead of current product prices.",
    draft_pr: { status: "not_attempted" },
    attempted_models: ["claude-sonnet-4-20250514"],
  },
}
