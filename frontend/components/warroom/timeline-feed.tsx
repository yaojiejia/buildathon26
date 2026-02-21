"use client"

import { useEffect, useRef } from "react"
import { useEngine } from "@/lib/engine"
import { AgentId, TimelineEvent } from "@/lib/types"
import { agentMeta } from "@/lib/agent-data"
import { cn } from "@/lib/utils"
import {
  ArrowRight,
  Lightbulb,
  CheckCircle2,
  MessageSquare,
} from "lucide-react"

function agentColor(id: AgentId): string {
  return agentMeta[id].color
}

function agentShortName(id: AgentId): string {
  const map: Record<AgentId, string> = {
    logs: "Logs",
    codebase: "Code",
    docs: "Docs",
    repro: "Repro",
  }
  return map[id]
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  const isSignal = event.type === "signal" && event.toAgent
  const isComplete = event.type === "complete"
  const isFinding = event.type === "finding"

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 px-4 py-2.5 transition-all duration-300",
        "border-b border-white/[0.03]"
      )}
    >
      {/* Icon */}
      <div className="mt-0.5 flex-shrink-0">
        {isSignal && <ArrowRight className="h-3.5 w-3.5 text-violet-400" />}
        {isFinding && <Lightbulb className="h-3.5 w-3.5 text-amber-400" />}
        {isComplete && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs">
          <span className={cn("font-semibold", agentColor(event.fromAgent))}>
            {agentShortName(event.fromAgent)}
          </span>
          {isSignal && event.toAgent && (
            <>
              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/40" />
              <span className={cn("font-semibold", agentColor(event.toAgent))}>
                {agentShortName(event.toAgent)}
              </span>
            </>
          )}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/40">
            +{(event.timestamp / 1000).toFixed(1)}s
          </span>
        </div>
        <p
          className={cn(
            "mt-0.5 text-xs leading-relaxed",
            isSignal && "text-violet-300/80",
            isFinding && "text-amber-300/80",
            isComplete && "text-emerald-300/80"
          )}
        >
          {/* Strip the "→ Agent:" prefix for cleaner display */}
          {event.message.replace(/^→\s*\w+\s*Agent:\s*/i, "")}
        </p>
      </div>
    </div>
  )
}

export function TimelineFeed() {
  const { state } = useEngine()
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevCount = useRef(0)

  const timeline = state.timeline

  useEffect(() => {
    if (timeline.length > prevCount.current && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      })
    }
    prevCount.current = timeline.length
  }, [timeline.length])

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/60" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Agent Comms
        </h2>
        {timeline.length > 0 && (
          <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-500/20 px-1 text-[10px] font-medium text-violet-300">
            {timeline.length}
          </span>
        )}
      </div>

      {/* Feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {timeline.length === 0 && (
          <div className="flex h-full items-center justify-center px-4 py-8">
            <p className="text-center text-xs text-muted-foreground/40">
              Cross-agent signals and findings will appear here as the
              investigation progresses.
            </p>
          </div>
        )}

        {timeline.map((event) => (
          <TimelineRow key={event.id} event={event} />
        ))}
      </div>
    </div>
  )
}
