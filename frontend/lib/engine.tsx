"use client"

import React, {
  createContext,
  useCallback,
  useContext,
  useReducer,
  useRef,
} from "react"
import {
  AgentEvent,
  AgentEventType,
  AgentId,
  AgentState,
  AgentStatus,
  ALL_AGENT_IDS,
  InvestigationReport,
  InvestigationState,
  TimelineEvent,
} from "./types"
import { agentMeta, allAgentEvents, demoReport } from "./agent-data"

// ─── Initial state ───────────────────────────────────────────
function makeInitialAgentState(id: AgentId): AgentState {
  const meta = agentMeta[id]
  return {
    id,
    name: meta.name,
    icon: meta.icon,
    status: "idle",
    events: [],
    color: meta.color,
  }
}

function makeAllAgents(status: AgentStatus = "idle"): Record<AgentId, AgentState> {
  const agents = {} as Record<AgentId, AgentState>
  for (const id of ALL_AGENT_IDS) {
    agents[id] = { ...makeInitialAgentState(id), status }
  }
  return agents
}

const initialState: InvestigationState = {
  status: "idle",
  agents: makeAllAgents("idle"),
  timeline: [],
  selectedAgent: null,
  elapsedMs: 0,
  report: null,
}

// ─── Actions ─────────────────────────────────────────────────
type Action =
  | { type: "START_INVESTIGATION" }
  | { type: "RESET" }
  | { type: "SELECT_AGENT"; agentId: AgentId | null }
  | { type: "AGENT_EVENT"; event: AgentEvent }
  | { type: "AGENT_STATUS"; agentId: AgentId; status: AgentStatus }
  | { type: "TIMELINE_EVENT"; event: TimelineEvent }
  | { type: "INVESTIGATION_COMPLETE" }
  | { type: "SET_REPORT"; report: InvestigationReport }
  | { type: "TICK"; elapsedMs: number }

// ─── Reducer ─────────────────────────────────────────────────
function reducer(state: InvestigationState, action: Action): InvestigationState {
  switch (action.type) {
    case "START_INVESTIGATION":
      return {
        ...initialState,
        status: "running",
        selectedAgent: null,
        agents: makeAllAgents("idle"),
      }

    case "RESET":
      return initialState

    case "SELECT_AGENT":
      return { ...state, selectedAgent: action.agentId }

    case "AGENT_EVENT": {
      const agentId = action.event.agentId
      const agent = state.agents[agentId]
      if (!agent) return state
      return {
        ...state,
        agents: {
          ...state.agents,
          [agentId]: {
            ...agent,
            events: [...agent.events, action.event],
            status: action.event.type === "finding" ? "finding" : agent.status,
          },
        },
      }
    }

    case "AGENT_STATUS":
      if (!state.agents[action.agentId]) return state
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.agentId]: {
            ...state.agents[action.agentId],
            status: action.status,
          },
        },
      }

    case "TIMELINE_EVENT":
      return {
        ...state,
        timeline: [...state.timeline, action.event],
      }

    case "INVESTIGATION_COMPLETE":
      return { ...state, status: "complete" }

    case "SET_REPORT":
      return { ...state, report: action.report }

    case "TICK":
      return { ...state, elapsedMs: action.elapsedMs }

    default:
      return state
  }
}

// ─── Backend SSE event → Frontend event mapping ──────────────

let _sseEventId = 0

interface BackendEvent {
  agent: string
  type: string
  step: string
  message: string
  data: Record<string, unknown>
  timestamp: number
}

const BACKEND_TYPE_MAP: Record<string, AgentEventType> = {
  status: "action",
  progress: "action",
  result: "result",
  error: "error",
  log: "action",
  complete: "success",
}

function isValidAgentId(id: string): id is AgentId {
  return ALL_AGENT_IDS.includes(id as AgentId)
}

function mapBackendEvent(be: BackendEvent, elapsedMs: number): AgentEvent | null {
  let agentId: AgentId

  if (be.agent === "pipeline") {
    if (be.step === "triage") agentId = "triage"
    else if (be.step === "codebase_search") agentId = "codebase_search"
    else if (be.step === "doc_analysis") agentId = "doc_analysis"
    else if (be.step === "log_analysis") agentId = "log_analysis"
    else if (be.step === "patch_generation") agentId = "patch_generation"
    else if (be.step === "report") agentId = "codebase_search"
    else return null
  } else if (isValidAgentId(be.agent)) {
    agentId = be.agent
  } else {
    return null
  }

  if (/^[═─]{5,}$/.test(be.message.trim())) return null

  const frontendType = BACKEND_TYPE_MAP[be.type] || "action"

  const detail = be.data && Object.keys(be.data).length > 0
    ? JSON.stringify(be.data, null, 2)
    : undefined

  return {
    id: `sse-${++_sseEventId}`,
    agentId,
    type: frontendType,
    message: be.message,
    detail,
    timestamp: elapsedMs,
    delay: 0,
  }
}

// ─── Context ─────────────────────────────────────────────────
interface EngineContext {
  state: InvestigationState
  dispatch: React.Dispatch<Action>
  startInvestigation: (params?: {
    issueTitle: string
    issueBody: string
    repoUrl: string
    repoName: string
  }) => void
  resetInvestigation: () => void
  selectAgent: (id: AgentId | null) => void
}

const Ctx = createContext<EngineContext | null>(null)

export function useEngine(): EngineContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useEngine must be used within EngineProvider")
  return ctx
}

// ─── Provider ────────────────────────────────────────────────
export function EngineProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const timeoutIds = useRef<ReturnType<typeof setTimeout>[]>([])
  const startTime = useRef<number>(0)
  const tickInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const clearAllTimeouts = useCallback(() => {
    timeoutIds.current.forEach(clearTimeout)
    timeoutIds.current = []
    if (tickInterval.current) {
      clearInterval(tickInterval.current)
      tickInterval.current = null
    }
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }, [])

  const selectAgent = useCallback(
    (id: AgentId | null) => dispatch({ type: "SELECT_AGENT", agentId: id }),
    [dispatch]
  )

  const resetInvestigation = useCallback(() => {
    clearAllTimeouts()
    dispatch({ type: "RESET" })
  }, [clearAllTimeouts])

  // ── Start investigation (real backend SSE or demo mock) ─────
  const startInvestigation = useCallback(
    (params?: {
      issueTitle: string
      issueBody: string
      repoUrl: string
      repoName: string
    }) => {
      clearAllTimeouts()
      dispatch({ type: "START_INVESTIGATION" })

      startTime.current = Date.now()

      tickInterval.current = setInterval(() => {
        dispatch({ type: "TICK", elapsedMs: Date.now() - startTime.current })
      }, 100)

      // ── Real backend SSE mode ───────────────────────────────
      if (params) {
        _sseEventId = 0
        const controller = new AbortController()
        abortRef.current = controller
        const activeAgents = new Set<AgentId>()

        for (const id of ALL_AGENT_IDS) {
          dispatch({ type: "AGENT_STATUS", agentId: id, status: "running" })
          activeAgents.add(id)
        }

        async function consumeSSE() {
          try {
            const res = await fetch("/api/investigate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                issue_title: params!.issueTitle,
                issue_body: params!.issueBody,
                repo_url: params!.repoUrl,
                repo_name: params!.repoName,
              }),
              signal: controller.signal,
            })

            if (!res.ok || !res.body) {
              dispatch({
                type: "AGENT_EVENT",
                event: {
                  id: "sse-err",
                  agentId: "triage",
                  type: "error",
                  message: `Backend returned ${res.status}. Is the Python server running on port 8000?`,
                  delay: 0,
                },
              })
              dispatch({ type: "AGENT_STATUS", agentId: "triage", status: "running" })
              return
            }

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ""

            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              buffer += decoder.decode(value, { stream: true })

              const lines = buffer.split("\n")
              buffer = lines.pop() || ""

              for (const line of lines) {
                if (!line.startsWith("data: ")) continue
                const jsonStr = line.slice(6).trim()
                if (!jsonStr) continue

                let be: BackendEvent
                try {
                  be = JSON.parse(jsonStr)
                } catch {
                  continue
                }

                const elapsedMs = Date.now() - startTime.current

                if (be.agent === "pipeline" && be.type === "complete") {
                  activeAgents.forEach((id) => {
                    dispatch({ type: "AGENT_STATUS", agentId: id, status: "done" })
                    dispatch({
                      type: "AGENT_EVENT",
                      event: {
                        id: `sse-${++_sseEventId}`,
                        agentId: id,
                        type: "complete",
                        message: `${agentMeta[id].name} complete`,
                        timestamp: elapsedMs,
                        delay: 0,
                      },
                    })
                  })
                  if (be.data?.report) {
                    dispatch({
                      type: "SET_REPORT",
                      report: be.data.report as InvestigationReport,
                    })
                  }
                  dispatch({ type: "INVESTIGATION_COMPLETE" })
                  if (tickInterval.current) {
                    clearInterval(tickInterval.current)
                    tickInterval.current = null
                  }
                  continue
                }

                if (be.agent === "pipeline" && be.type === "error") {
                  dispatch({
                    type: "AGENT_EVENT",
                    event: {
                      id: `sse-${++_sseEventId}`,
                      agentId: "triage",
                      type: "error",
                      message: be.message,
                      timestamp: elapsedMs,
                      delay: 0,
                    },
                  })
                  dispatch({ type: "INVESTIGATION_COMPLETE" })
                  if (tickInterval.current) {
                    clearInterval(tickInterval.current)
                    tickInterval.current = null
                  }
                  continue
                }

                const frontendEvent = mapBackendEvent(be, elapsedMs)
                if (!frontendEvent) continue

                if (!activeAgents.has(frontendEvent.agentId)) {
                  activeAgents.add(frontendEvent.agentId)
                  dispatch({
                    type: "AGENT_STATUS",
                    agentId: frontendEvent.agentId,
                    status: "running",
                  })
                }

                dispatch({ type: "AGENT_EVENT", event: frontendEvent })

                if (
                  be.type === "result" &&
                  be.step === "complete" &&
                  isValidAgentId(be.agent)
                ) {
                  dispatch({
                    type: "AGENT_EVENT",
                    event: {
                      id: `sse-${++_sseEventId}`,
                      agentId: be.agent as AgentId,
                      type: "complete",
                      message: be.message,
                      timestamp: elapsedMs,
                      delay: 0,
                    },
                  })
                  dispatch({
                    type: "AGENT_STATUS",
                    agentId: be.agent as AgentId,
                    status: "done",
                  })
                }
              }
            }
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") return
            console.error("SSE connection error:", err)
            dispatch({
              type: "AGENT_EVENT",
              event: {
                id: `sse-err-${++_sseEventId}`,
                agentId: "triage",
                type: "error",
                message: `Connection error: ${err instanceof Error ? err.message : String(err)}`,
                delay: 0,
              },
            })
          }
        }

        consumeSSE()
        return
      }

      // ── Demo mock mode (no params) ──────────────────────────
      let completedAgents = 0
      const totalAgents = ALL_AGENT_IDS.length

      function completeDemo() {
        dispatch({ type: "SET_REPORT", report: demoReport })
        dispatch({ type: "INVESTIGATION_COMPLETE" })
        if (tickInterval.current) {
          clearInterval(tickInterval.current)
          tickInterval.current = null
        }
      }

      ALL_AGENT_IDS.forEach((agentId) => {
        const events = allAgentEvents[agentId]
        if (events.length === 0) {
          dispatch({ type: "AGENT_STATUS", agentId, status: "done" })
          completedAgents++
          if (completedAgents >= totalAgents) completeDemo()
          return
        }

        dispatch({ type: "AGENT_STATUS", agentId, status: "running" })
        let cumulativeDelay = 0

        events.forEach((event) => {
          cumulativeDelay += event.delay

          const tid = setTimeout(() => {
            const timestamp = Date.now() - startTime.current
            const eventWithTimestamp = { ...event, timestamp }
            dispatch({ type: "AGENT_EVENT", event: eventWithTimestamp })

            if (event.type === "signal" || event.type === "finding" || event.type === "complete") {
              const timelineEvent: TimelineEvent = {
                id: `tl-${event.id}`,
                fromAgent: agentId,
                toAgent: event.targetAgent,
                message: event.message,
                timestamp,
                type: event.type === "signal" ? "signal" : event.type === "complete" ? "complete" : "finding",
              }
              dispatch({ type: "TIMELINE_EVENT", event: timelineEvent })
            }

            if (event.type === "complete") {
              dispatch({ type: "AGENT_STATUS", agentId, status: "done" })
              completedAgents++
              if (completedAgents >= totalAgents) completeDemo()
            }
          }, cumulativeDelay)

          timeoutIds.current.push(tid)
        })
      })
    },
    [clearAllTimeouts]
  )

  return (
    <Ctx.Provider
      value={{ state, dispatch, startInvestigation, resetInvestigation, selectAgent }}
    >
      {children}
    </Ctx.Provider>
  )
}
