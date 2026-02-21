"use client"

import { useEngine } from "@/lib/engine"
import { AgentId, AgentState, ALL_AGENT_IDS } from "@/lib/types"
import { agentMeta, allAgentEvents } from "@/lib/agent-data"
import { cn } from "@/lib/utils"
import {
  Search,
  BookOpen,
  ScrollText,
  Brain,
  Wrench,
  Activity,
  Rabbit,
  MessageSquareReply,
  Shield,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Circle,
  ChevronRight,
} from "lucide-react"

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Search,
  BookOpen,
  ScrollText,
  Brain,
  Wrench,
  Activity,
  Rabbit,
  MessageSquareReply,
  Shield,
}

function StatusBadge({ status }: { status: AgentState["status"] }) {
  switch (status) {
    case "idle":
      return (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Circle className="h-2 w-2" />
          Idle
        </span>
      )
    case "running":
      return (
        <span className="flex items-center gap-1.5 text-xs text-blue-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running
        </span>
      )
    case "finding":
      return (
        <span className="flex items-center gap-1.5 text-xs text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          Finding
        </span>
      )
    case "done":
      return (
        <span className="flex items-center gap-1.5 text-xs text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          Done
        </span>
      )
  }
}

function AgentCard({ agentId, isExpanded }: { agentId: AgentId; isExpanded: boolean }) {
  const { state, selectAgent } = useEngine()
  const agent = state.agents[agentId]
  const meta = agentMeta[agentId]
  const isSelected = state.selectedAgent === agentId
  const Icon = iconMap[meta.icon]

  const eventCount = agent.events.length
  const totalEvents = allAgentEvents[agentId].length
  const latestEvent = agent.events[agent.events.length - 1]

  const handleClick = () => {
    selectAgent(isSelected ? null : agentId)
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        "w-full text-left rounded-lg border transition-all duration-200",
        "hover:bg-white/[0.03] cursor-pointer",
        isSelected
          ? "border-white/20 bg-white/[0.05] shadow-[0_0_15px_rgba(255,255,255,0.03)]"
          : "border-white/[0.06] bg-transparent",
        isExpanded ? "p-4" : "p-3"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex items-center justify-center rounded-md",
              "bg-white/[0.05] border border-white/[0.06]",
              isExpanded ? "h-10 w-10" : "h-8 w-8"
            )}
          >
            {Icon && <Icon className={cn(isExpanded ? "h-5 w-5" : "h-4 w-4", meta.color)} />}
          </div>
          <div>
            <div className={cn(
              "font-medium text-foreground/90",
              isExpanded ? "text-sm" : "text-sm"
            )}>
              {meta.name}
            </div>
            <StatusBadge status={agent.status} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {eventCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white/[0.08] px-1.5 text-[10px] font-medium text-muted-foreground">
              {eventCount}
            </span>
          )}
          <ChevronRight
            className={cn(
              "h-4 w-4 text-muted-foreground/40 transition-transform duration-200",
              isSelected && "rotate-90 text-muted-foreground/70"
            )}
          />
        </div>
      </div>

      {isExpanded && (
        <p className="mt-1.5 text-xs text-muted-foreground/50 leading-relaxed">
          {meta.description}
        </p>
      )}

      {isExpanded && latestEvent && (
        <div className="mt-2.5 rounded-md border border-white/[0.04] bg-black/20 px-3 py-2">
          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-1">
            {latestEvent.message}
          </p>
        </div>
      )}

      {agent.status === "running" && (
        <div className={cn("h-[2px] w-full overflow-hidden rounded-full bg-white/[0.06]", isExpanded ? "mt-2.5" : "mt-2")}>
          {totalEvents > 0 ? (
            <div
              className={cn("h-full rounded-full transition-all duration-500", meta.color.replace("text-", "bg-").replace("400", "400/60"))}
              style={{ width: `${Math.min((eventCount / totalEvents) * 100, 95)}%` }}
            />
          ) : (
            <div
              className={cn("h-full w-1/3 rounded-full animate-pulse", meta.color.replace("text-", "bg-").replace("400", "400/60"))}
            />
          )}
        </div>
      )}
      {agent.status === "done" && (
        <div className={cn("h-[2px] w-full rounded-full bg-emerald-400/30", isExpanded ? "mt-2.5" : "mt-2")} />
      )}
    </button>
  )
}

export function AgentSidebar() {
  const { state } = useEngine()

  const isExpanded = state.selectedAgent === null

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-white/[0.06] px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Agents
        </h2>
      </div>

      {/* Agent rows — centered when expanded */}
      <div className={cn(
        "flex-1 overflow-y-auto",
        isExpanded ? "px-8 py-5" : "p-3"
      )}>
        <div className={cn(
          "w-full mx-auto",
          isExpanded ? "max-w-2xl space-y-2.5" : "space-y-1.5"
        )}>
          {ALL_AGENT_IDS.map((id) => (
            <AgentCard key={id} agentId={id} isExpanded={isExpanded} />
          ))}
        </div>
      </div>

      {/* Investigation status footer */}
      {state.status !== "idle" && (
        <div className="border-t border-white/[0.06] px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Status</span>
            <span
              className={cn(
                "text-xs font-medium",
                state.status === "running" && "text-blue-400",
                state.status === "complete" && "text-emerald-400"
              )}
            >
              {state.status === "running" ? "Investigating…" : "Complete"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Elapsed</span>
            <span className="font-mono text-xs text-foreground/70">
              {formatElapsed(state.elapsedMs)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${minutes}:${s.toString().padStart(2, "0")}`
}
