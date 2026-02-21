"use client"

import { useState } from "react"
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
  Rocket,
  Loader2,
  ArrowRight,
  ScrollText,
  Search,
  BookOpen,
  Brain,
  Wrench,
  Activity,
  Rabbit,
  MessageSquareReply,
} from "lucide-react"

type ExecutionStatus = "idle" | "running" | "done"

export function IntelReport() {
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>("idle")

  const handleExecute = () => {
    setExecutionStatus("running")
    setTimeout(() => setExecutionStatus("done"), 4000)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-3">
        <Shield className="h-4 w-4 text-emerald-400" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Gathered Intelligence
        </h2>
      </div>

      {/* Scrollable report body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Status banner */}
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
          <p className="text-sm font-semibold text-emerald-400">
            Investigation Complete
          </p>
          <p className="mt-1 text-xs text-foreground/60">
            8 agents converged on root cause for{" "}
            <span className="text-foreground/80 font-medium">{bugReport.id}</span>
          </p>
        </div>

        {/* Agent contributions summary */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Agent Contributions
          </h3>
          <div className="space-y-1.5">
            {[
              { icon: Search, color: "text-blue-400", agent: "Codebase Search", finding: "Commit b7e2f1a removed Redis SETNX guard; DB lacks UNIQUE constraint" },
              { icon: BookOpen, color: "text-emerald-400", agent: "Docs", finding: "ADR-019 violation — Redis idempotency layer was architecturally mandated" },
              { icon: ScrollText, color: "text-amber-400", agent: "Logs", finding: "847 webhooks missing idempotency; 142 customers affected ($23,847)" },
              { icon: Brain, color: "text-rose-400", agent: "Root Cause", finding: "Synthesized findings: removed SETNX + missing UNIQUE = race condition" },
              { icon: Wrench, color: "text-cyan-400", agent: "Patch Gen", finding: "PR #2848 — restore idempotency middleware + add DB constraint" },
              { icon: Activity, color: "text-violet-400", agent: "CI Status", finding: "All 4 CI jobs green — lint, unit tests, integration, migration" },
              { icon: Rabbit, color: "text-orange-400", agent: "CodeRabbit", finding: "Review passed — 1 nitpick suggestion (non-blocking)" },
              { icon: MessageSquareReply, color: "text-pink-400", agent: "Review Response", finding: "Addressed CodeRabbit suggestion, PR approved and merge-ready" },
            ].map((item, i) => (
              <div
                key={i}
                className="rounded-md border border-white/[0.04] bg-white/[0.02] px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <item.icon className={cn("h-3.5 w-3.5 flex-shrink-0", item.color)} />
                  <span className="text-xs font-semibold text-foreground/80">{item.agent}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {item.finding}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Root cause */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Root Cause
          </h3>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-foreground/75 leading-relaxed">
            Stripe webhook handler processes retried events as new events due to removed
            Redis idempotency guard (commit{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[10px] text-amber-300">
              b7e2f1a
            </code>
            ). Concurrent requests both pass the application-level dedup check because{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[10px] text-cyan-300">
              stripe_charge_id
            </code>{" "}
            has no UNIQUE constraint.
          </div>
        </section>

        {/* Evidence */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Evidence Chain
          </h3>
          <div className="space-y-1.5">
            {[
              { icon: FileCode2, color: "text-cyan-400", text: "src/api/webhooks/stripe.ts — no idempotency check" },
              { icon: Database, color: "text-blue-400", text: "charges table — missing UNIQUE on stripe_charge_id" },
              { icon: GitCommitHorizontal, color: "text-amber-400", text: "Commit b7e2f1a removed Redis SETNX guard" },
              { icon: ScrollText, color: "text-emerald-400", text: "847 webhook events with null idempotency_key" },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border border-white/[0.04] bg-white/[0.02] px-2.5 py-1.5"
              >
                <item.icon className={cn("mt-0.5 h-3 w-3 flex-shrink-0", item.color)} />
                <span className="text-[11px] text-foreground/60">{item.text}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Confidence */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Confidence
          </h3>
          <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-emerald-400/50 bg-emerald-400/10">
              <span className="text-sm font-bold text-emerald-400">96</span>
            </div>
            <div>
              <p className="text-xs font-medium text-foreground/80">High Confidence</p>
              <p className="text-[11px] text-muted-foreground">Reproduced &amp; fix verified</p>
            </div>
          </div>
        </section>

        {/* Alternatives rejected */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Rejected Hypotheses
          </h3>
          <div className="space-y-1.5">
            {[
              { h: "Stripe sending genuine duplicates", r: "Event IDs identical — retries, not separate charges" },
              { h: "DB write failure retry loop", r: "All writes succeed (200) — issue is concurrent success" },
            ].map((alt, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border border-white/[0.04] bg-white/[0.02] px-2.5 py-1.5"
              >
                <XCircle className="mt-0.5 h-3 w-3 flex-shrink-0 text-red-400/50" />
                <div>
                  <p className="text-[11px] font-medium text-foreground/60">{alt.h}</p>
                  <p className="text-[10px] text-muted-foreground">{alt.r}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Proposed fix */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Proposed Fix
          </h3>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
            <div className="flex items-start gap-2">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500/20 text-[9px] font-bold text-blue-400">1</span>
              <span className="text-[11px] text-foreground/70">Restore Redis SETNX idempotency check (fast path dedup)</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500/20 text-[9px] font-bold text-blue-400">2</span>
              <span className="text-[11px] text-foreground/70">Add UNIQUE constraint on charges.stripe_charge_id (safety net)</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500/20 text-[9px] font-bold text-blue-400">3</span>
              <span className="text-[11px] text-foreground/70">Run dedup script + issue refunds for 142 affected customers</span>
            </div>
          </div>
        </section>
      </div>

      {/* Footer — execution agent handoff */}
      <div className="border-t border-white/[0.06] p-4 space-y-3">
        {executionStatus === "idle" && (
          <button
            onClick={handleExecute}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold",
              "bg-white text-black shadow-lg shadow-white/10",
              "transition-all hover:bg-white/90 hover:shadow-white/15",
              "active:scale-[0.98]"
            )}
          >
            <Rocket className="h-4 w-4" />
            Send to Execution Agent
          </button>
        )}

        {executionStatus === "running" && (
          <div className="flex flex-col items-center gap-2 py-1">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
              <span className="text-sm font-medium text-blue-400">Execution Agent working…</span>
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
              Drafting PR with fix &amp; regression tests, routing through CodeRabbit…
            </p>
          </div>
        )}

        {executionStatus === "done" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-sm font-semibold">PR #2848 Created</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              fix: restore webhook idempotency guard + add UNIQUE constraint
            </p>
            <div className="flex gap-2">
              <button className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-white/[0.06]">
                <ExternalLink className="h-3 w-3" />
                View PR
              </button>
              <button className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-white/[0.06]">
                <ArrowRight className="h-3 w-3" />
                Open in Cursor
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
