"use client"

import { useEngine } from "@/lib/engine"
import { bugReport } from "@/lib/agent-data"
import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  Github,
  User,
  Clock,
  Tag,
  Zap,
} from "lucide-react"

export function IncidentHero() {
  const { startInvestigation } = useEngine()

  return (
    <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
      <div className="w-full max-w-2xl px-6">
        {/* Incident card */}
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] shadow-2xl">
          {/* Glow accent — cyan instead of red */}
          <div className="absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-cyan-500/8 blur-3xl" />

          <div className="relative p-8">
            {/* Severity badge */}
            <div className="mb-4 flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                {bugReport.severity.toUpperCase()}
              </span>
              <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-muted-foreground">
                {bugReport.id}
              </span>
            </div>

            {/* Title */}
            <h1 className="text-2xl font-bold tracking-tight text-foreground/95">
              {bugReport.title}
            </h1>

            {/* Meta row */}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Github className="h-3.5 w-3.5" />
                {bugReport.repo}
              </span>
              <span className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                @{bugReport.author}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {new Date(bugReport.createdAt).toLocaleString()}
              </span>
            </div>

            {/* Summary */}
            <p className="mt-5 text-sm leading-relaxed text-foreground/60">
              {bugReport.summary}
            </p>

            {/* Labels */}
            <div className="mt-4 flex flex-wrap gap-1.5">
              {bugReport.labels.map((label) => (
                <span
                  key={label}
                  className="flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  <Tag className="h-2.5 w-2.5" />
                  {label}
                </span>
              ))}
            </div>

            {/* Divider */}
            <div className="my-6 h-px bg-white/[0.06]" />

            {/* AI Summary */}
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Zap className="h-3.5 w-3.5 text-cyan-400" />
                AI SUMMARY
              </div>
              <p className="mt-2 text-sm leading-relaxed text-foreground/70">
                Likely a race condition in the Stripe webhook handler. Webhook retries
                are being processed as new events, creating duplicate charges. The issue
                correlates with deploy v2.14.0 which modified the webhook processing
                pipeline. Estimated 142 customers affected.
              </p>
            </div>

            {/* CTA */}
            <div className="mt-6 flex gap-3">
              <button
                onClick={startInvestigation}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold",
                  "bg-white/[0.07] text-foreground/90 border border-white/[0.12]",
                  "transition-all hover:bg-white/[0.12] hover:border-white/[0.18]",
                  "active:scale-[0.98]"
                )}
              >
                <Zap className="h-4 w-4 text-cyan-400" />
                Launch Investigation
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
