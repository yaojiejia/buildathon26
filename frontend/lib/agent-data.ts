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

// ─── Helper to make IDs ──────────────────────────────────────
let _id = 0
const id = () => `evt-${++_id}`

// ─── LOGS AGENT EVENTS ──────────────────────────────────────
export const logsAgentEvents: AgentEvent[] = [
  {
    id: id(), agentId: "logs", type: "action", delay: 400,
    message: "Connecting to Datadog log stream…",
  },
  {
    id: id(), agentId: "logs", type: "query", delay: 1200,
    message: "Querying logs: service:payment-service status:error @timestamp:[2026-02-18 TO *]",
    detail: "Scope: 48h window since v2.14.0 deploy",
  },
  {
    id: id(), agentId: "logs", type: "result", delay: 2000,
    message: "Found 1,247 error-level entries across 3 pods",
    detail: "pod-payment-7f8b4 (612 errors) | pod-payment-9a2c1 (401 errors) | pod-payment-3d5e8 (234 errors)",
  },
  {
    id: id(), agentId: "logs", type: "query", delay: 1400,
    message: "Filtering for duplicate charge patterns: grouping by idempotency_key…",
  },
  {
    id: id(), agentId: "logs", type: "error", delay: 2200,
    message: "⚠ 847 webhook events lack idempotency_key field entirely",
    detail: 'Log sample: {"event":"charge.created","amount":4999,"customer":"cus_R8x...","idempotency_key":null,"timestamp":"2026-02-19T14:22:01.447Z"}',
  },
  {
    id: id(), agentId: "logs", type: "query", delay: 1000,
    message: "Cross-referencing Stripe webhook delivery logs…",
  },
  {
    id: id(), agentId: "logs", type: "result", delay: 1800,
    message: "Stripe sent webhook event evt_1Ox... twice (retried after 200ms timeout)",
    detail: "First delivery: 14:22:01.234Z (HTTP 200 in 847ms)\nSecond delivery: 14:22:01.447Z (HTTP 200 in 312ms)\nBoth processed → two charges created",
  },
  {
    id: id(), agentId: "logs", type: "finding", delay: 1200,
    message: "ROOT CAUSE CANDIDATE: Webhook handler processes retried events as new events",
    detail: "The handler returns 200 before completing charge creation. Stripe retries, and the second delivery also creates a charge because there is no idempotency check.",
  },
  {
    id: id(), agentId: "logs", type: "signal", delay: 800,
    message: "→ Codebase Agent: Investigate webhook handler — likely missing idempotency guard",
    targetAgent: "codebase",
  },
  {
    id: id(), agentId: "logs", type: "query", delay: 1600,
    message: "Quantifying blast radius: counting unique customers with duplicate charges…",
  },
  {
    id: id(), agentId: "logs", type: "result", delay: 2000,
    message: "142 customers affected with 168 duplicate charge pairs totaling $23,847.00",
    detail: "Highest single duplicate: $499.00 (cus_Mx9...) | Earliest occurrence: Feb 18 16:04:12Z",
  },
  {
    id: id(), agentId: "logs", type: "signal", delay: 600,
    message: "→ Repro Agent: Webhook event ID evt_1Ox... can reproduce — Stripe retry window is 200ms",
    targetAgent: "repro",
  },
  {
    id: id(), agentId: "logs", type: "complete", delay: 1000,
    message: "Log analysis complete — 142 affected customers, root cause: missing idempotency check in webhook handler",
  },
]

// ─── CODEBASE AGENT EVENTS ───────────────────────────────────
export const codebaseAgentEvents: AgentEvent[] = [
  {
    id: id(), agentId: "codebase", type: "action", delay: 600,
    message: "Cloning acme/payment-service @ main (HEAD: a3f8c2d)…",
  },
  {
    id: id(), agentId: "codebase", type: "query", delay: 2400,
    message: "Searching codebase for webhook handler entry point…",
    detail: 'grep -rn "stripe.*webhook\\|handleWebhook\\|/webhooks/stripe" src/',
  },
  {
    id: id(), agentId: "codebase", type: "file_open", delay: 1800,
    message: "Opening src/api/webhooks/stripe.ts",
    detail: `export async function handleStripeWebhook(req: Request) {
  const event = stripe.webhooks.constructEvent(
    await req.text(),
    req.headers.get("stripe-signature")!,
    env.STRIPE_WEBHOOK_SECRET
  );

  // Process the event
  switch (event.type) {
    case "charge.succeeded":
      await processCharge(event.data.object);
      break;
    // ... other cases
  }

  return new Response("OK", { status: 200 });
}`,
  },
  {
    id: id(), agentId: "codebase", type: "error", delay: 1400,
    message: "⚠ No idempotency check before processCharge() — event processed unconditionally",
    detail: "The handler calls processCharge() for every incoming event without checking if this event ID was already processed. Response 200 is returned after processing, not before.",
  },
  {
    id: id(), agentId: "codebase", type: "file_open", delay: 1200,
    message: "Opening src/services/charges.ts → tracing processCharge()",
    detail: `export async function processCharge(charge: Stripe.Charge) {
  const existing = await db.charges.findByStripeId(charge.id);
  if (existing) {
    logger.info("Charge already recorded", { chargeId: charge.id });
    return; // dedup at DB level
  }

  await db.charges.create({
    stripeChargeId: charge.id,
    amount: charge.amount,
    customerId: charge.customer,
    status: charge.status,
  });

  await billingService.updateInvoice(charge.customer, charge.id);
}`,
  },
  {
    id: id(), agentId: "codebase", type: "finding", delay: 2000,
    message: "DB-level dedup exists but has a race condition — no SELECT FOR UPDATE or unique constraint",
    detail: "findByStripeId() does a plain SELECT. Two concurrent requests both get null, both INSERT. The stripe_charge_id column has no UNIQUE constraint.",
  },
  {
    id: id(), agentId: "codebase", type: "query", delay: 1000,
    message: "Checking migration history for schema constraints…",
    detail: "git log --oneline -- src/db/migrations/",
  },
  {
    id: id(), agentId: "codebase", type: "file_open", delay: 1600,
    message: "Opening src/db/migrations/20260215_add_charges_table.sql",
    detail: `CREATE TABLE charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_charge_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- NOTE: Missing UNIQUE constraint on stripe_charge_id`,
  },
  {
    id: id(), agentId: "codebase", type: "error", delay: 1200,
    message: "CONFIRMED: stripe_charge_id has no UNIQUE constraint — race condition is exploitable",
  },
  {
    id: id(), agentId: "codebase", type: "signal", delay: 800,
    message: "→ Docs Agent: Check Stripe docs for webhook idempotency best practices",
    targetAgent: "docs",
  },
  {
    id: id(), agentId: "codebase", type: "query", delay: 1400,
    message: "git log --oneline v2.13.0..v2.14.0 -- src/api/webhooks/",
  },
  {
    id: id(), agentId: "codebase", type: "result", delay: 1600,
    message: "Found culprit commit: b7e2f1a \"refactor: simplify webhook handler\" by @dev-marcus",
    detail: "This commit removed the Redis-based idempotency cache that was present in v2.13.0. The old implementation used SETNX with a 24h TTL to deduplicate webhook events.",
  },
  {
    id: id(), agentId: "codebase", type: "finding", delay: 1000,
    message: "ROOT CAUSE CONFIRMED: Commit b7e2f1a removed Redis idempotency guard, DB lacks unique constraint",
    detail: "Two-layer fix needed:\n1. Restore Redis SETNX idempotency check (fast path)\n2. Add UNIQUE constraint on charges.stripe_charge_id (safety net)",
  },
  {
    id: id(), agentId: "codebase", type: "signal", delay: 600,
    message: "→ Repro Agent: The race window is ~200ms between concurrent webhook deliveries",
    targetAgent: "repro",
  },
  {
    id: id(), agentId: "codebase", type: "complete", delay: 800,
    message: "Code analysis complete — fix strategy identified, ready to draft PR",
  },
]

// ─── DOCS AGENT EVENTS ──────────────────────────────────────
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
    id: id(), agentId: "docs", type: "result", delay: 2400,
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
    id: id(), agentId: "docs", type: "query", delay: 1400,
    message: "Checking Stripe official docs for webhook best practices…",
  },
  {
    id: id(), agentId: "docs", type: "result", delay: 2000,
    message: "Stripe docs confirm: \"Webhook endpoints might occasionally receive the same event more than once\"",
    detail: "From stripe.com/docs/webhooks#handle-duplicate-events:\n\"Make your event processing idempotent. Use the event ID to check if you've already processed it.\"",
  },
  {
    id: id(), agentId: "docs", type: "file_open", delay: 1600,
    message: "Reading Runbook: Payment Service Incident Response",
    detail: `## Duplicate Charges
Severity: P0 — customer-impacting financial data
1. Immediately pause webhook processing (kill switch: WEBHOOK_ENABLED=false)
2. Run dedup script: scripts/dedup-charges.ts
3. Issue refunds via Stripe dashboard for affected customers
4. Deploy fix with idempotency guard restored`,
  },
  {
    id: id(), agentId: "docs", type: "finding", delay: 1000,
    message: "Runbook has exact remediation steps — dedup script exists at scripts/dedup-charges.ts",
  },
  {
    id: id(), agentId: "docs", type: "signal", delay: 600,
    message: "→ Codebase Agent: ADR-019 mandates Redis SETNX — the removed code was architecturally required",
    targetAgent: "codebase",
  },
  {
    id: id(), agentId: "docs", type: "complete", delay: 1200,
    message: "Documentation review complete — ADR violation confirmed, runbook remediation steps available",
  },
]

// ─── REPRO AGENT EVENTS ─────────────────────────────────────
export const reproAgentEvents: AgentEvent[] = [
  {
    id: id(), agentId: "repro", type: "action", delay: 1000,
    message: "Spinning up isolated test environment (Docker Compose)…",
  },
  {
    id: id(), agentId: "repro", type: "action", delay: 3000,
    message: "Starting services: postgres:15, redis:7, payment-service:v2.14.0",
    detail: "Container IDs: pg_test_8f2a, redis_test_4b1c, pay_test_2e7d",
  },
  {
    id: id(), agentId: "repro", type: "action", delay: 2400,
    message: "Running database migrations and seeding test customer cus_test_001…",
  },
  {
    id: id(), agentId: "repro", type: "query", delay: 1600,
    message: "Configuring Stripe CLI to forward webhooks to local endpoint…",
    detail: "stripe listen --forward-to localhost:3000/api/webhooks/stripe",
  },
  {
    id: id(), agentId: "repro", type: "action", delay: 2000,
    message: "Test 1: Sending single webhook event → verifying baseline behavior…",
  },
  {
    id: id(), agentId: "repro", type: "success", delay: 1800,
    message: "✓ Single event processed correctly — 1 charge created for $49.99",
  },
  {
    id: id(), agentId: "repro", type: "action", delay: 1400,
    message: "Test 2: Simulating Stripe retry — sending same event ID twice with 200ms gap…",
    detail: 'curl -X POST localhost:3000/api/webhooks/stripe -d \'{"id":"evt_test_dup","type":"charge.succeeded",...}\' & sleep 0.2 && curl -X POST ...',
  },
  {
    id: id(), agentId: "repro", type: "error", delay: 2200,
    message: "✗ REPRODUCED: 2 charges created for same event ID evt_test_dup",
    detail: "SELECT count(*) FROM charges WHERE stripe_charge_id = 'ch_test_dup';\n→ 2\n\nBoth requests returned HTTP 200. No dedup occurred.",
  },
  {
    id: id(), agentId: "repro", type: "finding", delay: 1000,
    message: "BUG CONFIRMED: Concurrent webhook deliveries bypass the application-level dedup check",
  },
  {
    id: id(), agentId: "repro", type: "signal", delay: 600,
    message: "→ Logs Agent: Confirmed 200ms race window — matches production log patterns exactly",
    targetAgent: "logs",
  },
  {
    id: id(), agentId: "repro", type: "action", delay: 1800,
    message: "Test 3: Applying proposed fix (Redis SETNX + UNIQUE constraint) and re-testing…",
  },
  {
    id: id(), agentId: "repro", type: "success", delay: 2400,
    message: "✓ Fix verified: Duplicate webhook rejected with 200 status, only 1 charge created",
    detail: "Redis SETNX blocked the second request at application layer.\nUNIQUE constraint on stripe_charge_id provides database-level safety net.",
  },
  {
    id: id(), agentId: "repro", type: "action", delay: 1200,
    message: "Running regression test suite (47 tests)…",
  },
  {
    id: id(), agentId: "repro", type: "success", delay: 2600,
    message: "✓ All 47 tests pass — including 3 new idempotency tests",
    detail: "test_single_webhook_processed ✓\ntest_duplicate_webhook_rejected ✓\ntest_concurrent_webhooks_single_charge ✓\n... 44 more ✓",
  },
  {
    id: id(), agentId: "repro", type: "complete", delay: 800,
    message: "Reproduction complete — bug confirmed and fix validated with regression tests",
  },
]

// ─── Export all events grouped by agent ──────────────────────
export const allAgentEvents: Record<AgentId, AgentEvent[]> = {
  logs: logsAgentEvents,
  codebase: codebaseAgentEvents,
  docs: docsAgentEvents,
  repro: reproAgentEvents,
}

// ─── Agent metadata ──────────────────────────────────────────
export const agentMeta: Record<AgentId, { name: string; icon: string; color: string; description: string }> = {
  logs: {
    name: "Logs Agent",
    icon: "ScrollText",
    color: "text-amber-400",
    description: "Queries logging systems for errors related to the bug",
  },
  codebase: {
    name: "Codebase Agent",
    icon: "Code2",
    color: "text-blue-400",
    description: "Browses the repository and traces the issue through code",
  },
  docs: {
    name: "Docs Agent",
    icon: "BookOpen",
    color: "text-emerald-400",
    description: "Checks internal runbooks and documentation for context",
  },
  repro: {
    name: "Repro Agent",
    icon: "FlaskConical",
    color: "text-purple-400",
    description: "Sets up test environments and attempts to reproduce the bug",
  },
}
