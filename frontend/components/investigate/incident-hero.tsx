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
  Play,
} from "lucide-react"
import { GlowingEffect } from "@/components/ui/glowing-effect"
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button"

export function IncidentHero() {
  const { startInvestigation } = useEngine()

  const handleRealInvestigation = () => {
    startInvestigation({
      issueTitle: bugReport.title,
      issueBody: bugReport.summary,
      repoUrl: `https://github.com/${bugReport.repo}`,
      repoName: bugReport.repo,
    })
  }

  const handleDemoInvestigation = () => {
    startInvestigation()
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
      <div className="w-full max-w-2xl px-6">
        {/* Incident card */}
        <div className="group relative rounded-2xl">
          <GlowingEffect
            spread={40}
            glow={true}
            disabled={false}
            proximity={64}
            inactiveZone={0.01}
            borderWidth={2}
          />
          <div className="group/summary relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] shadow-2xl">
          {/* Glow accent */}
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
            <h1 className="text-2xl font-bold tracking-tight text-foreground/95 transition-colors duration-200 group-hover/summary:text-foreground">
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
            <p className="mt-5 text-sm leading-relaxed text-foreground/60 transition-colors duration-200 group-hover/summary:text-foreground/80">
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
            <div className="group/ai-summary rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 transition-shadow duration-200 hover:shadow-[0_0_20px_rgba(34,211,238,0.15)]">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground transition-colors duration-200 group-hover/ai-summary:text-foreground/70">
                <Zap className="h-3.5 w-3.5 text-cyan-400" />
                AI SUMMARY
              </div>
              <p className="mt-2 text-sm leading-relaxed text-foreground/70 transition-colors duration-200 group-hover/ai-summary:text-foreground/90">
                The process_refund function recalculates refund amounts using current
                product prices instead of the price_at_purchase stored in order_items.
                If prices changed since the order, customers get the wrong refund amount.
                The code ignores order.total entirely despite the docstring specifying it.
              </p>
            </div>

            {/* CTA */}
            <div className="mt-6 flex gap-3">
              <InteractiveHoverButton
                onClick={handleRealInvestigation}
                text="Launch Investigation"
                variant="primary"
                className="flex-1 px-6 py-3"
              >
                <Zap className="h-4 w-4 text-cyan-400" />
              </InteractiveHoverButton>
              <InteractiveHoverButton
                onClick={handleDemoInvestigation}
                text="Demo Mode"
                variant="secondary"
                className="flex-1 px-6 py-3"
              >
                <Play className="h-4 w-4" />
              </InteractiveHoverButton>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}
