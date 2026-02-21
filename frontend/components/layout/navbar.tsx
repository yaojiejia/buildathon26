"use client"

import { useEngine } from "@/lib/engine"
import { bugReport } from "@/lib/agent-data"
import { cn } from "@/lib/utils"
import {
  Bug,
  RotateCcw,
  Github,
  Zap,
} from "lucide-react"

export function Navbar() {
  const { state, startInvestigation, resetInvestigation } = useEngine()

  return (
    <header className="flex h-14 items-center justify-between border-b border-white/[0.06] bg-black/40 px-5 backdrop-blur-sm">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/20">
          <Bug className="h-4 w-4 text-cyan-400" />
        </div>
        <span className="text-sm font-bold tracking-tight text-foreground/90">
          BugPilot
        </span>

        {state.status !== "idle" && (
          <>
            <div className="mx-2 h-4 w-px bg-white/[0.08]" />
            <div className="flex items-center gap-2">
              <Github className="h-3.5 w-3.5 text-muted-foreground/60" />
              <span className="text-xs text-muted-foreground">
                {bugReport.repo}
              </span>
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                {bugReport.severity.toUpperCase()}
              </span>
              <span className="text-xs text-muted-foreground/70">
                #{bugReport.id}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {state.status === "idle" && (
          <button
            onClick={startInvestigation}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium",
              "bg-white/[0.06] text-foreground/90 border border-white/[0.1]",
              "transition-all hover:bg-white/[0.1] hover:border-white/[0.15]",
              "active:scale-[0.97]"
            )}
          >
            <Zap className="h-4 w-4 text-cyan-400" />
            Investigate
          </button>
        )}

        {state.status === "running" && (
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500" />
            </span>
            <span className="text-xs font-medium text-cyan-400">
              Investigation in progress
            </span>
          </div>
        )}

        {state.status === "complete" && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-emerald-400">
              ✓ Investigation complete
            </span>
          </div>
        )}

        {state.status !== "idle" && (
          <button
            onClick={resetInvestigation}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-2 text-xs font-medium",
              "text-muted-foreground transition-all hover:bg-white/[0.04] hover:text-foreground/80"
            )}
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        )}
      </div>
    </header>
  )
}
