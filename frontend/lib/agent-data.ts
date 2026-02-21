import { AgentEvent, AgentId, BugReport } from "./types"

// ─── The bug we're investigating ─────────────────────────────
export const bugReport: BugReport = {
  id: "GH-2847",
  title: "Duplicate charges appearing on customer invoices",
  repo: "acme/payment-service",
  author: "sarah-chen",
  severity: "critical",
  summary:
    "Multiple customers reporting duplicate charges on their credit cards. Stripe dashboard shows two identical charge objects created within 200ms of each other. Affects roughly 3% of transactions since deploy v2.14.0 on Feb 18.",
  labels: ["bug", "payments", "P0", "customer-impacting"],
  createdAt: "2026-02-20T09:14:00Z",
}

let _id = 0
const id = () => `evt-${++_id}`

// ─── CODEBASE SEARCH AGENT (RAG) ────────────────────────────
export const codebaseSearchEvents: AgentEvent[] = [
  {
    id: id(), agentId: "codebase_search", type: "action", delay: 600,
    message: "Indexing acme/payment-service @ main (HEAD: a3f8c2d)…",
  },
  {
    id: id(), agentId: "codebase_search", type: "query", delay: 2000,
    message: "RAG query: \"stripe webhook handler duplicate charge idempotency\"",
    detail: "Embedding search across 1,847 files in repository",
  },
  {
    id: id(), agentId: "codebase_search", type: "result", delay: 1800,
    message: "Top 5 results ranked by semantic similarity",
    detail: "1. src/api/webhooks/stripe.ts (0.94)\n2. src/services/charges.ts (0.89)\n3. src/db/migrations/20260215_add_charges_table.sql (0.82)\n4. src/middleware/idempotency.ts (0.78) — DELETED in v2.14.0\n5. tests/webhooks/stripe.test.ts (0.71)",
  },
  {
    id: id(), agentId: "codebase_search", type: "file_open", delay: 1600,
    message: "Opening src/api/webhooks/stripe.ts",
    detail: `export async function handleStripeWebhook(req: Request) {
  const event = stripe.webhooks.constructEvent(
    await req.text(),
    req.headers.get("stripe-signature")!,
    env.STRIPE_WEBHOOK_SECRET
  );

  switch (event.type) {
    case "charge.succeeded":
      await processCharge(event.data.object);
      break;
  }

  return new Response("OK", { status: 200 });
}`,
  },
  {
    id: id(), agentId: "codebase_search", type: "error", delay: 1400,
    message: "⚠ No idempotency check before processCharge() — event processed unconditionally",
  },
  {
    id: id(), agentId: "codebase_search", type: "file_open", delay: 1200,
    message: "Opening src/services/charges.ts → tracing processCharge()",
    detail: `export async function processCharge(charge: Stripe.Charge) {
  const existing = await db.charges.findByStripeId(charge.id);
  if (existing) {
    logger.info("Charge already recorded", { chargeId: charge.id });
    return;
  }
  await db.charges.create({
    stripeChargeId: charge.id, amount: charge.amount,
    customerId: charge.customer, status: charge.status,
  });
  await billingService.updateInvoice(charge.customer, charge.id);
}`,
  },
  {
    id: id(), agentId: "codebase_search", type: "finding", delay: 1800,
    message: "Race condition in processCharge() — no SELECT FOR UPDATE, no UNIQUE constraint on stripe_charge_id",
  },
  {
    id: id(), agentId: "codebase_search", type: "query", delay: 1200,
    message: "git log --oneline v2.13.0..v2.14.0 -- src/api/webhooks/ src/middleware/",
  },
  {
    id: id(), agentId: "codebase_search", type: "result", delay: 1600,
    message: "Culprit: commit b7e2f1a \"refactor: simplify webhook handler\" by @dev-marcus",
    detail: "Removed src/middleware/idempotency.ts which contained Redis SETNX guard with 24h TTL.",
  },
  {
    id: id(), agentId: "codebase_search", type: "signal", delay: 600,
    message: "→ Root Cause Synthesis: Commit b7e2f1a removed Redis idempotency, DB has no unique constraint",
    targetAgent: "root_cause",
  },
  {
    id: id(), agentId: "codebase_search", type: "complete", delay: 800,
    message: "Codebase search complete — webhook handler, charge service, and culprit commit identified",
  },
]

// ─── DOCS AGENT ──────────────────────────────────────────────
export const docsAgentEvents: AgentEvent[] = [
  {
    id: id(), agentId: "docs", type: "action", delay: 800,
    message: "Indexing internal documentation and runbooks…",
  },
  {
    id: id(), agentId: "docs", type: "query", delay: 2000,
    message: 'Searching: "payment" OR "webhook" OR "idempotency" in Confluence & Notion…',
  },
  {
    id: id(), agentId: "docs", type: "result", delay: 2200,
    message: "Found 3 relevant documents",
    detail: "1. [Runbook] Payment Service Incident Response\n2. [ADR-019] Webhook Processing Architecture\n3. [Guide] Stripe Integration Best Practices",
  },
  {
    id: id(), agentId: "docs", type: "file_open", delay: 1600,
    message: "Reading ADR-019: Webhook Processing Architecture",
    detail: `## Decision
We use a Redis-based idempotency layer to deduplicate Stripe webhooks.
Each event ID is stored with SETNX and a 24-hour TTL.

## Status: ACCEPTED (2025-08-14)
## Author: @lead-eng-julia

## Consequences
- All webhook handlers MUST check Redis before processing
- If Redis is unavailable, fall back to DB-level dedup with SELECT FOR UPDATE`,
  },
  {
    id: id(), agentId: "docs", type: "error", delay: 1200,
    message: "⚠ ADR-019 mandates Redis idempotency — commit b7e2f1a violated this architecture decision",
  },
  {
    id: id(), agentId: "docs", type: "result", delay: 1800,
    message: "Stripe docs: \"Webhook endpoints might occasionally receive the same event more than once\"",
    detail: "stripe.com/docs/webhooks#handle-duplicate-events:\n\"Make your event processing idempotent. Use the event ID to check if you've already processed it.\"",
  },
  {
    id: id(), agentId: "docs", type: "file_open", delay: 1400,
    message: "Reading Runbook: Payment Service Incident Response",
    detail: `## Duplicate Charges — Severity P0
1. Pause webhook processing (WEBHOOK_ENABLED=false)
2. Run dedup script: scripts/dedup-charges.ts
3. Issue refunds for affected customers
4. Deploy fix with idempotency guard restored`,
  },
  {
    id: id(), agentId: "docs", type: "finding", delay: 1000,
    message: "Runbook has exact remediation steps — dedup script at scripts/dedup-charges.ts",
  },
  {
    id: id(), agentId: "docs", type: "signal", delay: 600,
    message: "→ Root Cause Synthesis: ADR-019 mandates Redis SETNX — removed code was architecturally required",
    targetAgent: "root_cause",
  },
  {
    id: id(), agentId: "docs", type: "complete", delay: 1000,
    message: "Documentation review complete — ADR violation confirmed, runbook remediation available",
  },
]

// ─── LOGS AGENT ──────────────────────────────────────────────
export const logsAgentEvents: AgentEvent[] = [
  {
    id: id(), agentId: "logs", type: "action", delay: 400,
    message: "Connecting to Datadog log stream…",
  },
  {
    id: id(), agentId: "logs", type: "query", delay: 1200,
    message: "Querying: service:payment-service status:error @timestamp:[2026-02-18 TO *]",
    detail: "Scope: 48h window since v2.14.0 deploy",
  },
  {
    id: id(), agentId: "logs", type: "result", delay: 1800,
    message: "Found 1,247 error-level entries across 3 pods",
    detail: "pod-payment-7f8b4 (612) | pod-payment-9a2c1 (401) | pod-payment-3d5e8 (234)",
  },
  {
    id: id(), agentId: "logs", type: "query", delay: 1400,
    message: "Filtering for duplicate charge patterns: grouping by idempotency_key…",
  },
  {
    id: id(), agentId: "logs", type: "error", delay: 2000,
    message: "⚠ 847 webhook events lack idempotency_key field entirely",
    detail: '{"event":"charge.created","amount":4999,"customer":"cus_R8x...","idempotency_key":null}',
  },
  {
    id: id(), agentId: "logs", type: "result", delay: 1800,
    message: "Stripe webhook evt_1Ox... delivered twice — retried after 200ms timeout",
    detail: "First: 14:22:01.234Z (200 in 847ms)\nSecond: 14:22:01.447Z (200 in 312ms)\nBoth processed → 2 charges",
  },
  {
    id: id(), agentId: "logs", type: "finding", delay: 1200,
    message: "ROOT CAUSE CANDIDATE: Webhook handler processes retried events as new events",
  },
  {
    id: id(), agentId: "logs", type: "result", delay: 1800,
    message: "Blast radius: 142 customers, 168 duplicate pairs, $23,847 in overcharges",
  },
  {
    id: id(), agentId: "logs", type: "signal", delay: 600,
    message: "→ Root Cause Synthesis: 142 customers affected, 200ms retry window exploitable",
    targetAgent: "root_cause",
  },
  {
    id: id(), agentId: "logs", type: "complete", delay: 1000,
    message: "Log analysis complete — blast radius quantified, root cause pattern identified",
  },
]

// ─── ROOT CAUSE SYNTHESIS AGENT ──────────────────────────────
export const rootCauseEvents: AgentEvent[] = [
  {
    id: id(), agentId: "root_cause", type: "action", delay: 2000,
    message: "Waiting for upstream agent findings…",
  },
  {
    id: id(), agentId: "root_cause", type: "action", delay: 8000,
    message: "Received findings from Codebase Search, Docs, and Logs agents",
  },
  {
    id: id(), agentId: "root_cause", type: "query", delay: 1400,
    message: "Cross-referencing evidence from all agents…",
    detail: "Codebase: commit b7e2f1a removed idempotency middleware\nDocs: ADR-019 violation\nLogs: 847 unguarded webhooks, 142 customers affected",
  },
  {
    id: id(), agentId: "root_cause", type: "finding", delay: 2000,
    message: "ROOT CAUSE CONFIRMED: Removed Redis SETNX guard + missing DB UNIQUE constraint",
    detail: "Commit b7e2f1a removed the idempotency middleware that guarded against Stripe webhook retries. The charges table lacks a UNIQUE constraint on stripe_charge_id, allowing concurrent inserts. 200ms retry window = exploitable race condition.",
  },
  {
    id: id(), agentId: "root_cause", type: "result", delay: 1600,
    message: "Confidence: 96% — reproduced pattern matches production logs exactly",
  },
  {
    id: id(), agentId: "root_cause", type: "action", delay: 1200,
    message: "Generating fix strategy…",
    detail: "1. Restore Redis SETNX idempotency check (fast path)\n2. Add UNIQUE constraint on charges.stripe_charge_id (safety net)\n3. Run dedup script + issue refunds for 142 affected customers",
  },
  {
    id: id(), agentId: "root_cause", type: "signal", delay: 800,
    message: "→ Patch Generation: Fix strategy ready — restore SETNX + add UNIQUE constraint",
    targetAgent: "patch_gen",
  },
  {
    id: id(), agentId: "root_cause", type: "complete", delay: 600,
    message: "Root cause synthesis complete — high confidence, fix strategy dispatched",
  },
]

// ─── PATCH GENERATION AGENT ─────────────────────────────────
export const patchGenEvents: AgentEvent[] = [
  {
    id: id(), agentId: "patch_gen", type: "action", delay: 1000,
    message: "Waiting for root cause synthesis…",
  },
  {
    id: id(), agentId: "patch_gen", type: "action", delay: 14000,
    message: "Received fix strategy from Root Cause Synthesis agent",
  },
  {
    id: id(), agentId: "patch_gen", type: "action", delay: 1600,
    message: "Creating branch: fix/gh-2847-webhook-idempotency",
  },
  {
    id: id(), agentId: "patch_gen", type: "action", delay: 2000,
    message: "Generating patch: restore src/middleware/idempotency.ts",
    detail: `export async function idempotencyGuard(eventId: string): Promise<boolean> {
  const key = \`webhook:idem:\${eventId}\`;
  const result = await redis.set(key, "1", { NX: true, EX: 86400 });
  return result !== null; // true = first time, false = duplicate
}`,
  },
  {
    id: id(), agentId: "patch_gen", type: "action", delay: 1800,
    message: "Generating migration: add UNIQUE constraint on charges.stripe_charge_id",
    detail: `ALTER TABLE charges
  ADD CONSTRAINT charges_stripe_charge_id_unique
  UNIQUE (stripe_charge_id);`,
  },
  {
    id: id(), agentId: "patch_gen", type: "action", delay: 1400,
    message: "Generating 3 regression tests for idempotency…",
    detail: "test_single_webhook_processed\ntest_duplicate_webhook_rejected\ntest_concurrent_webhooks_single_charge",
  },
  {
    id: id(), agentId: "patch_gen", type: "success", delay: 1600,
    message: "✓ Patch generated — 4 files changed, 87 additions, 3 deletions",
  },
  {
    id: id(), agentId: "patch_gen", type: "signal", delay: 600,
    message: "→ CI Status: PR #2848 created, awaiting CI pipeline",
    targetAgent: "ci_status",
  },
  {
    id: id(), agentId: "patch_gen", type: "complete", delay: 800,
    message: "Patch generation complete — PR #2848 opened on fix/gh-2847-webhook-idempotency",
  },
]

// ─── CI STATUS TRACKING ─────────────────────────────────────
export const ciStatusEvents: AgentEvent[] = [
  {
    id: id(), agentId: "ci_status", type: "action", delay: 1000,
    message: "Waiting for patch generation…",
  },
  {
    id: id(), agentId: "ci_status", type: "action", delay: 20000,
    message: "Monitoring CI pipeline for PR #2848…",
  },
  {
    id: id(), agentId: "ci_status", type: "action", delay: 2000,
    message: "CI triggered: GitHub Actions workflow 'test-and-lint' running…",
    detail: "Jobs: lint, unit-tests, integration-tests, migration-check",
  },
  {
    id: id(), agentId: "ci_status", type: "success", delay: 2400,
    message: "✓ Lint passed (eslint + prettier)",
  },
  {
    id: id(), agentId: "ci_status", type: "success", delay: 3000,
    message: "✓ Unit tests passed (47/47 including 3 new idempotency tests)",
  },
  {
    id: id(), agentId: "ci_status", type: "success", delay: 2800,
    message: "✓ Integration tests passed (12/12)",
  },
  {
    id: id(), agentId: "ci_status", type: "success", delay: 1800,
    message: "✓ Migration check passed — UNIQUE constraint is safe to apply",
  },
  {
    id: id(), agentId: "ci_status", type: "signal", delay: 600,
    message: "→ CodeRabbit: CI green, PR ready for review",
    targetAgent: "coderabbit",
  },
  {
    id: id(), agentId: "ci_status", type: "complete", delay: 800,
    message: "CI pipeline passed — all 4 jobs green",
  },
]

// ─── CODERABBIT REVIEW INTEGRATION ──────────────────────────
export const coderabbitEvents: AgentEvent[] = [
  {
    id: id(), agentId: "coderabbit", type: "action", delay: 1000,
    message: "Waiting for CI to pass…",
  },
  {
    id: id(), agentId: "coderabbit", type: "action", delay: 30000,
    message: "Submitting PR #2848 to CodeRabbit for automated review…",
  },
  {
    id: id(), agentId: "coderabbit", type: "result", delay: 3000,
    message: "CodeRabbit review received — 1 suggestion, 0 blocking issues",
    detail: "Suggestion: Consider adding a comment explaining the 86400s (24h) TTL choice in idempotency guard.\nSeverity: nitpick",
  },
  {
    id: id(), agentId: "coderabbit", type: "signal", delay: 800,
    message: "→ Review Response: CodeRabbit has 1 nitpick suggestion to address",
    targetAgent: "review_response",
  },
  {
    id: id(), agentId: "coderabbit", type: "complete", delay: 600,
    message: "CodeRabbit review complete — no blocking issues, 1 nitpick forwarded",
  },
]

// ─── REVIEW RESPONSE AGENT (SAFE AUTO-ITERATION) ────────────
export const reviewResponseEvents: AgentEvent[] = [
  {
    id: id(), agentId: "review_response", type: "action", delay: 1000,
    message: "Waiting for CodeRabbit review…",
  },
  {
    id: id(), agentId: "review_response", type: "action", delay: 34000,
    message: "Processing CodeRabbit feedback on PR #2848…",
  },
  {
    id: id(), agentId: "review_response", type: "result", delay: 1600,
    message: "Evaluating suggestion: add TTL comment to idempotency guard",
    detail: "Classification: nitpick (non-blocking)\nRisk: none — documentation-only change\nAuto-iteration: SAFE to apply",
  },
  {
    id: id(), agentId: "review_response", type: "action", delay: 1400,
    message: "Applying suggestion: adding inline comment for TTL rationale…",
    detail: `// 24h TTL matches Stripe's webhook retry window (per stripe.com/docs/webhooks)
const result = await redis.set(key, "1", { NX: true, EX: 86400 });`,
  },
  {
    id: id(), agentId: "review_response", type: "success", delay: 1200,
    message: "✓ Pushed fix-up commit to PR #2848",
  },
  {
    id: id(), agentId: "review_response", type: "success", delay: 2000,
    message: "✓ CodeRabbit re-review: all suggestions addressed, approved",
  },
  {
    id: id(), agentId: "review_response", type: "success", delay: 1000,
    message: "✓ PR #2848 ready to merge — all checks passed, review approved",
  },
  {
    id: id(), agentId: "review_response", type: "complete", delay: 800,
    message: "Review response complete — PR approved and merge-ready",
  },
]

// ─── Export all events grouped by agent ──────────────────────
export const allAgentEvents: Record<AgentId, AgentEvent[]> = {
  codebase_search: codebaseSearchEvents,
  docs: docsAgentEvents,
  logs: logsAgentEvents,
  root_cause: rootCauseEvents,
  patch_gen: patchGenEvents,
  ci_status: ciStatusEvents,
  coderabbit: coderabbitEvents,
  review_response: reviewResponseEvents,
}

// ─── Agent metadata ──────────────────────────────────────────
export const agentMeta: Record<AgentId, { name: string; icon: string; color: string; description: string }> = {
  codebase_search: {
    name: "Codebase Search",
    icon: "Search",
    color: "text-blue-400",
    description: "RAG-powered search across the repository to find relevant code",
  },
  docs: {
    name: "Docs Agent",
    icon: "BookOpen",
    color: "text-emerald-400",
    description: "Checks internal runbooks, ADRs, and documentation for context",
  },
  logs: {
    name: "Logs Agent",
    icon: "ScrollText",
    color: "text-amber-400",
    description: "Queries logging systems for errors and patterns related to the bug",
  },
  root_cause: {
    name: "Root Cause Synthesis",
    icon: "Brain",
    color: "text-rose-400",
    description: "Cross-references all agent findings to determine root cause",
  },
  patch_gen: {
    name: "Patch Generation",
    icon: "Wrench",
    color: "text-cyan-400",
    description: "Generates code patches, migrations, and regression tests",
  },
  ci_status: {
    name: "CI Status Tracking",
    icon: "Activity",
    color: "text-violet-400",
    description: "Monitors CI pipeline and reports job statuses",
  },
  coderabbit: {
    name: "CodeRabbit Review",
    icon: "Rabbit",
    color: "text-orange-400",
    description: "Routes PR through CodeRabbit for automated code review",
  },
  review_response: {
    name: "Review Response",
    icon: "MessageSquareReply",
    color: "text-pink-400",
    description: "Safely auto-iterates on review feedback and addresses suggestions",
  },
}
