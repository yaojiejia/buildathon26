/**
 * Case state machine (TICKET-1.2): validated transitions + audit log.
 */

import { prisma } from "@/lib/db"

export const CASE_STATES = [
  "NEW",
  "OPEN", // legacy; same transitions as NEW
  "TRIAGED",
  "NOTIFIED",
  "WAITING_FOR_ADMIN",
  "INVESTIGATING",
  "REPORT_READY",
  "PATCHING",
  "PR_OPENED",
  "UNDER_REVIEW",
  "NEEDS_HUMAN",
  "READY_TO_MERGE",
  "FAILED",
] as const

export type CaseState = (typeof CASE_STATES)[number]

/** Allowed next states: any state can transition to any other (go back from anywhere). */
const ALL_STATES_LIST = [...CASE_STATES] as CaseState[]
const ALLOWED_TRANSITIONS: Record<CaseState, CaseState[]> = Object.fromEntries(
  CASE_STATES.map((s) => [s, ALL_STATES_LIST])
) as Record<CaseState, CaseState[]>

export function isAllowedTransition(from: string, to: string): boolean {
  const fromState = from as CaseState
  const toState = to as CaseState
  if (!CASE_STATES.includes(toState)) return false
  const allowed = ALLOWED_TRANSITIONS[fromState]
  if (!allowed) return false
  return allowed.includes(toState)
}

export type TransitionResult =
  | { ok: true; caseId: string; fromState: string; toState: string }
  | { ok: false; error: string }

/**
 * Validate transition, record audit log, update case state. Rejects illegal transitions.
 */
export async function transitionCase(
  caseId: string,
  toState: string,
  metadata?: Record<string, unknown>
): Promise<TransitionResult> {
  const to = toState as CaseState
  if (!CASE_STATES.includes(to)) {
    return { ok: false, error: `Invalid state: ${toState}` }
  }

  const caseRecord = await prisma.case.findUnique({ where: { id: caseId } })
  if (!caseRecord) {
    return { ok: false, error: "Case not found" }
  }

  const from = caseRecord.state
  const sameState = from === toState
  if (!sameState && !isAllowedTransition(from, toState)) {
    return { ok: false, error: `Illegal transition: ${from} → ${toState}` }
  }

  await prisma.$transaction([
    prisma.caseStateTransition.create({
      data: {
        caseId,
        fromState: from,
        toState,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    }),
    prisma.case.update({
      where: { id: caseId },
      data: { state: toState, updatedAt: new Date() },
    }),
  ])

  return { ok: true, caseId, fromState: from, toState }
}

/**
 * Get state history (audit log) for a case, newest first.
 */
export async function getCaseStateHistory(caseId: string) {
  return prisma.caseStateTransition.findMany({
    where: { caseId },
    orderBy: { createdAt: "desc" },
  })
}

/**
 * Record initial state when a case is created (NEW). Call after prisma.case.create.
 */
export async function recordInitialState(caseId: string): Promise<void> {
  await prisma.caseStateTransition.create({
    data: {
      caseId,
      fromState: "NEW",
      toState: "NEW",
      metadata: JSON.stringify({ source: "case_created" }),
    },
  })
}
