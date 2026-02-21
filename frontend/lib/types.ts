// ─── Agent IDs ───────────────────────────────────────────────
export type AgentId = "logs" | "codebase" | "docs" | "repro"

// ─── Agent status through investigation lifecycle ────────────
export type AgentStatus = "idle" | "running" | "finding" | "done"

// ─── Event types for individual agent actions ────────────────
export type AgentEventType =
  | "query"      // Agent runs a search/query
  | "result"     // Agent receives a result
  | "file_open"  // Agent opens a file
  | "finding"    // Agent surfaces a finding
  | "signal"     // Agent sends a message to another agent (cross-agent)
  | "action"     // Agent performs an action (e.g., setting up env)
  | "success"    // Agent confirms something positive
  | "error"      // Agent encounters an error/suspicious item
  | "complete"   // Agent finishes its work

// ─── Single agent event ──────────────────────────────────────
export interface AgentEvent {
  id: string
  agentId: AgentId
  type: AgentEventType
  message: string
  detail?: string           // Extra detail (code snippet, log line, etc.)
  targetAgent?: AgentId     // For signal events: who receives
  timestamp?: number        // Filled at playback time (ms from start)
  delay: number             // ms to wait before showing this event
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
  icon: string              // Lucide icon name
  status: AgentStatus
  events: AgentEvent[]      // Events that have been "played" so far
  color: string             // Tailwind color class
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
