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
  AgentId,
  AgentState,
  AgentStatus,
  InvestigationState,
  TimelineEvent,
} from "./types"
import { agentMeta, allAgentEvents } from "./agent-data"

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

const initialState: InvestigationState = {
  status: "idle",
  agents: {
    logs: makeInitialAgentState("logs"),
    codebase: makeInitialAgentState("codebase"),
    docs: makeInitialAgentState("docs"),
    repro: makeInitialAgentState("repro"),
  },
  timeline: [],
  selectedAgent: null,
  elapsedMs: 0,
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
  | { type: "TICK"; elapsedMs: number }

// ─── Reducer ─────────────────────────────────────────────────
function reducer(state: InvestigationState, action: Action): InvestigationState {
  switch (action.type) {
    case "START_INVESTIGATION":
      return {
        ...initialState,
        status: "running",
        selectedAgent: null,
        agents: {
          logs: { ...makeInitialAgentState("logs"), status: "running" },
          codebase: { ...makeInitialAgentState("codebase"), status: "running" },
          docs: { ...makeInitialAgentState("docs"), status: "running" },
          repro: { ...makeInitialAgentState("repro"), status: "running" },
        },
      }

    case "RESET":
      return initialState

    case "SELECT_AGENT":
      return { ...state, selectedAgent: action.agentId }

    case "AGENT_EVENT": {
      const agentId = action.event.agentId
      const agent = state.agents[agentId]
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

    case "TICK":
      return { ...state, elapsedMs: action.elapsedMs }

    default:
      return state
  }
}

// ─── Context ─────────────────────────────────────────────────
interface EngineContext {
  state: InvestigationState
  dispatch: React.Dispatch<Action>
  startInvestigation: () => void
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

  // Store all active timeout IDs so we can clear them on reset
  const timeoutIds = useRef<ReturnType<typeof setTimeout>[]>([])
  const startTime = useRef<number>(0)
  const tickInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearAllTimeouts = useCallback(() => {
    timeoutIds.current.forEach(clearTimeout)
    timeoutIds.current = []
    if (tickInterval.current) {
      clearInterval(tickInterval.current)
      tickInterval.current = null
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

  const startInvestigation = useCallback(() => {
    // Clear any existing state
    clearAllTimeouts()
    dispatch({ type: "START_INVESTIGATION" })

    startTime.current = Date.now()

    // Start elapsed timer
    tickInterval.current = setInterval(() => {
      dispatch({ type: "TICK", elapsedMs: Date.now() - startTime.current })
    }, 100)

    // Track how many agents have completed
    let completedAgents = 0
    const totalAgents = 4

    // For each agent, schedule its events sequentially
    const agentIds: AgentId[] = ["logs", "codebase", "docs", "repro"]

    agentIds.forEach((agentId) => {
      const events = allAgentEvents[agentId]
      let cumulativeDelay = 0

      events.forEach((event) => {
        cumulativeDelay += event.delay

        const tid = setTimeout(() => {
          const timestamp = Date.now() - startTime.current

          // Dispatch the agent event with timestamp
          const eventWithTimestamp = { ...event, timestamp }
          dispatch({ type: "AGENT_EVENT", event: eventWithTimestamp })

          // If it's a signal event, also add to timeline
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

          // If it's a complete event, mark agent done
          if (event.type === "complete") {
            dispatch({ type: "AGENT_STATUS", agentId, status: "done" })
            completedAgents++

            // Check if all agents are done
            if (completedAgents >= totalAgents) {
              dispatch({ type: "INVESTIGATION_COMPLETE" })
              if (tickInterval.current) {
                clearInterval(tickInterval.current)
                tickInterval.current = null
              }
            }
          }
        }, cumulativeDelay)

        timeoutIds.current.push(tid)
      })
    })
  }, [clearAllTimeouts])

  return (
    <Ctx.Provider
      value={{ state, dispatch, startInvestigation, resetInvestigation, selectAgent }}
    >
      {children}
    </Ctx.Provider>
  )
}
