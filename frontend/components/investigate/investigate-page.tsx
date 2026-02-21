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
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Agent panel — wide & centered by default, shrinks when thinking process is open */}
      <div
        className={cn(
          "flex-shrink-0 border-r border-white/[0.06] bg-black/20 transition-all duration-400 ease-out overflow-hidden",
          hasSelectedAgent ? "w-72" : "flex-1"
        )}
      >
        <AgentSidebar />
      </div>

      {/* Thinking process column — slides in when agent is selected */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-400 ease-out",
          hasSelectedAgent
            ? "flex-1 min-w-0 opacity-100"
            : "w-0 opacity-0"
        )}
      >
        <AgentDetail />
      </div>

      {/* Intel report — slides in from right after investigation completes */}
      <div
        className={cn(
          "flex-shrink-0 overflow-hidden border-white/[0.06] bg-black/20 transition-all duration-500 ease-out",
          isComplete
            ? "w-[480px] border-l opacity-100"
            : "w-0 opacity-0"
        )}
      >
        <div className="w-[480px] h-full">
          <IntelReport />
        </div>
      </div>
    </div>
  )
}
