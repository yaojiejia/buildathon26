"use client"

import { useEffect, useRef } from "react"
import { useEngine } from "@/lib/engine"
import { AgentEvent, AgentEventType } from "@/lib/types"
import { agentMeta } from "@/lib/agent-data"
import { cn } from "@/lib/utils"
import {
  Search,
  FileCode2,
  Lightbulb,
  ArrowRight,
  Play,
  CheckCircle2,
  AlertTriangle,
  Terminal,
  ScrollText,
  BookOpen,
  Brain,
  Wrench,
  Activity,
  Rabbit,
  MessageSquareReply,
  X,
} from "lucide-react"

const agentIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Search,
  BookOpen,
  ScrollText,
  Brain,
  Wrench,
  Activity,
  Rabbit,
  MessageSquareReply,
}

function EventIcon({ type }: { type: AgentEventType }) {
  const cls = "h-3.5 w-3.5 flex-shrink-0"
  switch (type) {
    case "query":
      return <Search className={cn(cls, "text-blue-400")} />
    case "result":
      return <Terminal className={cn(cls, "text-slate-400")} />
    case "file_open":
      return <FileCode2 className={cn(cls, "text-cyan-400")} />
    case "finding":
      return <Lightbulb className={cn(cls, "text-amber-400")} />
    case "signal":
      return <ArrowRight className={cn(cls, "text-violet-400")} />
    case "action":
      return <Play className={cn(cls, "text-slate-400")} />
    case "success":
      return <CheckCircle2 className={cn(cls, "text-emerald-400")} />
    case "error":
      return <AlertTriangle className={cn(cls, "text-red-400")} />
    case "complete":
      return <CheckCircle2 className={cn(cls, "text-emerald-400")} />
    default:
      return <Terminal className={cn(cls, "text-slate-400")} />
  }
}

function EventRow({ event, isNew }: { event: AgentEvent; isNew: boolean }) {
  return (
    <div
      className={cn(
        "group border-l-2 py-2 pl-3 pr-2 transition-all duration-500",
        event.type === "finding" && "border-l-amber-400/60 bg-amber-400/[0.03]",
        event.type === "error" && "border-l-red-400/60 bg-red-400/[0.03]",
        event.type === "signal" && "border-l-violet-400/60 bg-violet-400/[0.03]",
        event.type === "success" && "border-l-emerald-400/60 bg-emerald-400/[0.03]",
        event.type === "complete" && "border-l-emerald-400/60 bg-emerald-400/[0.03]",
        event.type === "query" && "border-l-blue-400/30",
        event.type === "result" && "border-l-slate-500/30",
        event.type === "file_open" && "border-l-cyan-400/30",
        event.type === "action" && "border-l-slate-500/30",
        isNew && "animate-in"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5">
          <EventIcon type={event.type} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p
              className={cn(
                "text-sm leading-relaxed",
                event.type === "finding" && "font-semibold text-amber-300",
                event.type === "error" && "font-medium text-red-300",
                event.type === "signal" && "text-violet-300 italic",
                event.type === "success" && "text-emerald-300",
                event.type === "complete" && "font-semibold text-emerald-300",
                event.type === "query" && "text-foreground/80",
                event.type === "result" && "text-foreground/70",
                event.type === "file_open" && "text-cyan-300/90",
                event.type === "action" && "text-foreground/60"
              )}
            >
              {event.message}
            </p>
            {event.timestamp !== undefined && (
              <span className="flex-shrink-0 font-mono text-[10px] text-muted-foreground/50">
                +{(event.timestamp / 1000).toFixed(1)}s
              </span>
            )}
          </div>

          {event.detail && (
            <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-md border border-white/[0.04] bg-black/30 p-2.5 font-mono text-xs leading-relaxed text-muted-foreground">
              {event.detail}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

export function AgentDetail() {
  const { state, selectAgent } = useEngine()
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevEventCount = useRef(0)

  const selectedId = state.selectedAgent
  const agent = selectedId ? state.agents[selectedId] : null
  const meta = selectedId ? agentMeta[selectedId] : null
  const Icon = meta ? agentIconMap[meta.icon] : null

  const currentEventCount = agent?.events.length ?? 0
  useEffect(() => {
    if (currentEventCount > prevEventCount.current && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      })
    }
    prevEventCount.current = currentEventCount
  }, [currentEventCount])

  if (!selectedId || !agent || !meta) {
    return null
  }

  return (
    <div className="flex h-full flex-col border-r border-white/[0.06]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-3">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md",
            "bg-white/[0.05] border border-white/[0.06]"
          )}
        >
          {Icon && <Icon className={cn("h-4 w-4", meta.color)} />}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground/90">
            {meta.name}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              Thinking Process
            </span>
          </h2>
          <p className="text-xs text-muted-foreground truncate">{meta.description}</p>
        </div>

        {agent.status === "running" && (
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <span className="text-xs font-medium text-red-400">LIVE</span>
          </div>
        )}

        <button
          onClick={() => selectAgent(null)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-white/[0.05] hover:text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Event stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {agent.events.length === 0 && agent.status === "running" && (
          <div className="flex h-32 items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground/50">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/20" />
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/20" style={{ animationDelay: "200ms" }} />
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/20" style={{ animationDelay: "400ms" }} />
              <span className="ml-1">Initializing…</span>
            </div>
          </div>
        )}

        <div className="divide-y divide-white/[0.03]">
          {agent.events.map((event, i) => (
            <EventRow
              key={event.id}
              event={event}
              isNew={i === agent.events.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
