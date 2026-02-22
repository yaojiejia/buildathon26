// ─── Agent IDs (matches team tickets) ────────────────────────
export type AgentId =
  | "triage"            // Triage Agent — severity, module, duplicate detection
  | "codebase_search"   // TICKET-3.2 — Codebase Search Agent (RAG)
  | "docs"              // TICKET-3.3 — Docs Agent
  | "logs"              // TICKET-3.4 — Logs Agent
  | "root_cause"        // TICKET-3.5 — Root Cause Synthesis Agent
  | "patch_gen"         // TICKET-4.1 — Patch Generation Agent
  | "ci_status"         // TICKET-4.2 — CI Status Tracking
  | "coderabbit"        // TICKET-4.3 — CodeRabbit Review Integration
  | "review_response"   // TICKET-4.4 — Review Response Agent

export const ALL_AGENT_IDS: AgentId[] = [
  "triage",
  "codebase_search",
  "docs",
  "logs",
  "root_cause",
  "patch_gen",
  "ci_status",
  "coderabbit",
  "review_response",
]

// ─── Agent status through investigation lifecycle ────────────
export type AgentStatus = "idle" | "running" | "finding" | "done"

// ─── Event types for individual agent actions ────────────────
export type AgentEventType =
  | "query"
  | "result"
  | "file_open"
  | "finding"
  | "signal"
  | "action"
  | "success"
  | "error"
  | "complete"

// ─── Single agent event ──────────────────────────────────────
export interface AgentEvent {
  id: string
  agentId: AgentId
  type: AgentEventType
  message: string
  detail?: string
  targetAgent?: AgentId
  timestamp?: number
  delay: number
}

// ─── Timeline event (cross-agent communication) ──────────────
export interface TimelineEvent {
  id: string
  fromAgent: AgentId
  toAgent?: AgentId
  message: string
  timestamp: number
  type: "signal" | "finding" | "complete"
}

// ─── Per-agent state ─────────────────────────────────────────
export interface AgentState {
  id: AgentId
  name: string
  icon: string
  status: AgentStatus
  events: AgentEvent[]
  color: string
}

// ─── Full investigation state ────────────────────────────────
export interface InvestigationState {
  status: "idle" | "running" | "complete"
  agents: Record<AgentId, AgentState>
  timeline: TimelineEvent[]
  selectedAgent: AgentId | null
  elapsedMs: number
}

// ─── Bug info for the incident trigger ───────────────────────
export interface BugReport {
  id: string
  title: string
  repo: string
  author: string
  severity: "critical" | "high" | "medium" | "low"
  summary: string
  labels: string[]
  createdAt: string
}
