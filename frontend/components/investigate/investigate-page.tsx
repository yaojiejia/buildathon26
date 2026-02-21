"use client"

import { useEngine } from "@/lib/engine"
import { AgentSidebar } from "./agent-sidebar"
import { AgentDetail } from "./agent-detail"
import { IntelReport } from "./intel-report"
import { cn } from "@/lib/utils"

export function InvestigatePage() {
  const { state } = useEngine()

  const isComplete = state.status === "complete"
  const hasSelectedAgent = state.selectedAgent !== null

  return (
    <div className="relative h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Intel report — pinned to the right, doesn't move */}
      <div
        className={cn(
          "absolute top-0 right-0 h-full overflow-hidden border-white/[0.06] bg-black/40 backdrop-blur-sm transition-all duration-500 ease-out z-10",
          isComplete
            ? "w-[480px] border-l opacity-100"
            : "w-0 opacity-0"
        )}
      >
        <div className="w-[480px] h-full">
          <IntelReport />
        </div>
      </div>

      {/* Main content area — shrinks when intel report is visible */}
      <div
        className={cn(
          "flex h-full transition-all duration-500 ease-out",
          isComplete ? "mr-[480px]" : "mr-0"
        )}
      >
        {/* Agent panel — wide by default, shrinks when thinking process is open */}
        <div
          className={cn(
            "flex-shrink-0 border-r border-white/[0.06] bg-black/20 transition-all duration-[750ms] ease-in-out overflow-hidden",
            hasSelectedAgent ? "w-80" : "flex-1"
          )}
        >
          <AgentSidebar />
        </div>

        {/* Thinking process column — slides in when agent is selected */}
        <div
          className={cn(
            "overflow-hidden transition-all duration-500 ease-in-out",
            hasSelectedAgent
              ? "flex-1 min-w-0 opacity-100"
              : "w-0 opacity-0"
          )}
        >
          <AgentDetail />
        </div>
      </div>
    </div>
  )
}
