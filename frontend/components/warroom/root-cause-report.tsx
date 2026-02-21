"use client"

import { cn } from "@/lib/utils"
import { bugReport } from "@/lib/agent-data"
import {
  Shield,
  GitCommitHorizontal,
  FileCode2,
  Database,
  ExternalLink,
  CheckCircle2,
  XCircle,
} from "lucide-react"

export function RootCauseReport() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Header */}
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
        <div className="flex items-center gap-2 text-emerald-400">
          <Shield className="h-5 w-5" />
          <h2 className="text-lg font-bold">Root Cause Analysis Complete</h2>
        </div>
        <p className="mt-2 text-sm text-foreground/70">
          Investigation of{" "}
          <span className="font-semibold text-foreground/90">
            {bugReport.title}
          </span>{" "}
          has concluded with high confidence.
        </p>
      </div>

      {/* What broke */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          What Broke
        </h3>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-foreground/80 leading-relaxed">
          The Stripe webhook handler in{" "}
          <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-cyan-300">
            src/api/webhooks/stripe.ts
          </code>{" "}
          processes retried webhook events as new events, creating duplicate charges.
          The application-level dedup check in{" "}
          <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-cyan-300">
            processCharge()
          </code>{" "}
          has a race condition, and the database lacks a UNIQUE constraint on{" "}
          <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-cyan-300">
            stripe_charge_id
          </code>.
        </div>
      </section>

      {/* Why */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Why It Happened
        </h3>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-foreground/80 leading-relaxed">
          <div className="flex items-start gap-2">
            <GitCommitHorizontal className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
            <span>
              Commit{" "}
              <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-amber-300">
                b7e2f1a
              </code>{" "}
              by @dev-marcus removed the Redis-based idempotency cache as part of a
              &quot;simplify webhook handler&quot; refactor in v2.14.0. This violated
              ADR-019 which mandates the Redis SETNX guard.
            </span>
          </div>
        </div>
      </section>

      {/* Evidence */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Evidence
        </h3>
        <div className="space-y-2">
          {[
            {
              icon: FileCode2,
              color: "text-cyan-400",
              text: "src/api/webhooks/stripe.ts — no idempotency check before processCharge()",
            },
            {
              icon: Database,
              color: "text-blue-400",
              text: "charges table — stripe_charge_id column missing UNIQUE constraint",
            },
            {
              icon: GitCommitHorizontal,
              color: "text-amber-400",
              text: "git log v2.13.0..v2.14.0 — commit b7e2f1a removed Redis SETNX guard",
            },
            {
              icon: FileCode2,
              color: "text-emerald-400",
              text: "847 webhook events with null idempotency_key in Datadog logs",
            },
          ].map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 rounded-md border border-white/[0.04] bg-white/[0.02] px-3 py-2"
            >
              <item.icon
                className={cn("mt-0.5 h-3.5 w-3.5 flex-shrink-0", item.color)}
              />
              <span className="text-xs text-foreground/70">{item.text}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Confidence */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Confidence
        </h3>
        <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-emerald-400/50 bg-emerald-400/10">
            <span className="text-lg font-bold text-emerald-400">96</span>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground/80">
              High Confidence
            </p>
            <p className="text-xs text-muted-foreground">
              Root cause reproduced in isolated environment with fix verified
            </p>
          </div>
        </div>
      </section>

      {/* Alternatives considered */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Alternatives Considered & Rejected
        </h3>
        <div className="space-y-2">
          {[
            {
              hypothesis: "Stripe sending genuine duplicate charges",
              reason:
                "Ruled out: Stripe event IDs are identical — these are retries, not separate charges",
            },
            {
              hypothesis: "Database write failure causing retry loop",
              reason:
                "Ruled out: All DB writes succeed (HTTP 200) — the issue is two concurrent writes both succeeding",
            },
          ].map((alt, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 rounded-md border border-white/[0.04] bg-white/[0.02] px-3 py-2.5"
            >
              <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400/60" />
              <div>
                <p className="text-xs font-medium text-foreground/70">
                  {alt.hypothesis}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {alt.reason}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button className="flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90">
          <CheckCircle2 className="h-4 w-4" />
          View Draft PR
        </button>
        <button className="flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/[0.06]">
          <ExternalLink className="h-4 w-4" />
          Open in Cursor
        </button>
      </div>
    </div>
  )
}
