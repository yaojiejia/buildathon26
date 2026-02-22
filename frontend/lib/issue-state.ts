/**
 * In-memory issue state and creation time. Keyed by Slack channel + message ts (one thread = one issue).
 */

export type IssueState =
  | "OPEN"
  | "INVESTIGATING"
  | "REPORT_READY"
  | "PR_OPENED"
  | "REVIEW_COMPLETED"
  | "NEEDS_HUMAN"

const stateStore = new Map<string, IssueState>()
const createdAtStore = new Map<string, number>()

function key(channelId: string, messageTs: string): string {
  return `${channelId}:${messageTs}`
}

export function getIssueState(channelId: string, messageTs: string): IssueState {
  return stateStore.get(key(channelId, messageTs)) ?? "OPEN"
}

export function setIssueState(
  channelId: string,
  messageTs: string,
  state: IssueState
): void {
  stateStore.set(key(channelId, messageTs), state)
}

export function transitionTo(
  channelId: string,
  messageTs: string,
  newState: IssueState
): IssueState {
  setIssueState(channelId, messageTs, newState)
  return newState
}

/** Record when this thread (issue) was created so we can show time elapsed. */
export function recordIssueCreated(channelId: string, messageTs: string): void {
  const k = key(channelId, messageTs)
  if (!createdAtStore.has(k)) createdAtStore.set(k, Date.now())
}

export function getIssueCreatedAt(
  channelId: string,
  messageTs: string
): number | null {
  return createdAtStore.get(key(channelId, messageTs)) ?? null
}
