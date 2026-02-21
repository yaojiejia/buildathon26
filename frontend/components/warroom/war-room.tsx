"use client"

import { useEngine } from "@/lib/engine"
import { AgentSidebar } from "./agent-sidebar"
import { AgentDetail } from "./agent-detail"
import { TimelineFeed } from "./timeline-feed"
import { RootCauseReport } from "./root-cause-report"
import { cn } from "@/lib/utils"

export function WarRoom() {
  const { state } = useEngine()

  const isComplete = state.status === "complete"

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Left sidebar — agent list */}
      <div className="w-64 flex-shrink-0 border-r border-white/[0.06] bg-black/20">
        <AgentSidebar />
      </div>

      {/* Center — agent detail OR root cause report */}
      <div className="flex-1 overflow-hidden border-r border-white/[0.06]">
        {isComplete ? <RootCauseReport /> : <AgentDetail />}
      </div>

      {/* Right panel — timeline feed */}
      <div
        className={cn(
          "w-72 flex-shrink-0 bg-black/20",
          "transition-all duration-300"
        )}
      >
        <TimelineFeed />
      </div>
    </div>
  )
}
