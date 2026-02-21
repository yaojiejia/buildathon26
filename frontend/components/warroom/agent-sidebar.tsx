"use client"

import { useEngine } from "@/lib/engine"
import { AgentId, AgentState } from "@/lib/types"
import { agentMeta } from "@/lib/agent-data"
import { cn } from "@/lib/utils"
import {
  ScrollText,
  Code2,
  BookOpen,
  FlaskConical,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Circle,
} from "lucide-react"

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  ScrollText,
  Code2,
  BookOpen,
  FlaskConical,
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

function AgentCard({ agentId }: { agentId: AgentId }) {
  const { state, selectAgent } = useEngine()
  const agent = state.agents[agentId]
  const meta = agentMeta[agentId]
  const isSelected = state.selectedAgent === agentId
  const Icon = iconMap[meta.icon]

  const eventCount = agent.events.length

  return (
    <button
      onClick={() => selectAgent(agentId)}
      className={cn(
        "w-full text-left rounded-lg border p-3 transition-all duration-200",
        "hover:bg-white/[0.03] cursor-pointer",
        isSelected
          ? "border-white/20 bg-white/[0.05] shadow-[0_0_15px_rgba(255,255,255,0.03)]"
          : "border-white/[0.06] bg-transparent"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md",
              "bg-white/[0.05] border border-white/[0.06]"
            )}
          >
            {Icon && <Icon className={cn("h-4 w-4", meta.color)} />}
          </div>
          <div>
            <div className="text-sm font-medium text-foreground/90">
              {meta.name}
            </div>
            <StatusBadge status={agent.status} />
          </div>
        </div>

        {eventCount > 0 && (
          <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-white/[0.08] px-1.5 text-[10px] font-medium text-muted-foreground">
            {eventCount}
          </span>
        )}
      </div>

      {/* Mini progress bar */}
      {agent.status === "running" && (
        <div className="mt-2.5 h-[2px] w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              agentId === "logs" && "bg-amber-400/60",
              agentId === "codebase" && "bg-blue-400/60",
              agentId === "docs" && "bg-emerald-400/60",
              agentId === "repro" && "bg-purple-400/60"
            )}
            style={{
              width: `${Math.min(
                (eventCount / (agentId === "repro" ? 15 : 13)) * 100,
                95
              )}%`,
            }}
          />
        </div>
      )}
      {agent.status === "done" && (
        <div className="mt-2.5 h-[2px] w-full rounded-full bg-emerald-400/30" />
      )}
    </button>
  )
}

export function AgentSidebar() {
  const { state } = useEngine()
  const agentIds: AgentId[] = ["logs", "codebase", "docs", "repro"]

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-white/[0.06] px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Agents
        </h2>
      </div>

      {/* Agent list */}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {agentIds.map((id) => (
          <AgentCard key={id} agentId={id} />
        ))}
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
