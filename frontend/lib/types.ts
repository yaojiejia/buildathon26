// ─── Agent IDs (matches backend events.py identifiers) ───────
export type AgentId =
  | "triage"            // Triage Agent — severity, module, duplicate detection
  | "codebase_search"   // Codebase Search Agent (RAG)
  | "doc_analysis"      // Documentation Analysis Agent
  | "log_analysis"      // Log Analysis Agent (Sentry)
  | "patch_generation"  // Patch Generation Agent

export const ALL_AGENT_IDS: AgentId[] = [
  "triage",
  "codebase_search",
  "doc_analysis",
  "log_analysis",
  "patch_generation",
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

// ─── Backend report shape (from pipeline.complete event) ─────
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface InvestigationReport {
  issue: { title: string; body: string; repo: string }
  triage: {
    severity: string
    likely_module: string
    is_duplicate: boolean
    duplicate_of: string | null
    summary: string
  }
  investigation: {
    suspect_files: {
      file_path: string
      why_relevant: string
      lines_referenced: number[]
      snippet: string
    }[]
    reasoning: string
    confidence: string
    questions_asked: string[]
    evidence_collected: {
      question: string
      answer: string
      sources: any[]
    }[]
  }
  documentation: {
    relevant_docs: {
      file_path: string
      why_relevant: string
      key_sections: string[]
    }[]
    reasoning: string
    confidence: string
    total_docs_scanned: number
    relevant_messages: any[]
  }
  log_analysis: {
    suspicious_logs: {
      event_id: string
      timestamp: string
      message: string
      level: string
      why_suspicious: string
    }[]
    patterns_found: string[]
    timeline: string
    confidence: string
    total_events_scanned: number
    error?: string
  }
  patch_generation: {
    status: string
    error?: string
    changed_files: string[]
    diff?: string
    pr_title?: string
    pr_body_markdown?: string
    draft_pr?: { status: string; url?: string; error?: string }
    branch?: string
    commit_sha?: string
    attempted_models?: string[]
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Full investigation state ────────────────────────────────
export interface InvestigationState {
  status: "idle" | "running" | "complete"
  agents: Record<AgentId, AgentState>
  timeline: TimelineEvent[]
  selectedAgent: AgentId | null
  elapsedMs: number
  report: InvestigationReport | null
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
