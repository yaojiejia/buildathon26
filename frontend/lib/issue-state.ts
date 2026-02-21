/**
 * In-memory issue state store. Keyed by Slack channel + message ts (one thread = one issue).
 */

export type IssueState = "OPEN" | "INVESTIGATING" | "NEEDS_HUMAN"

const store = new Map<string, IssueState>()

function key(channelId: string, messageTs: string): string {
  return `${channelId}:${messageTs}`
}

export function getIssueState(channelId: string, messageTs: string): IssueState {
  return store.get(key(channelId, messageTs)) ?? "OPEN"
}

export function setIssueState(
  channelId: string,
  messageTs: string,
  state: IssueState
): void {
  store.set(key(channelId, messageTs), state)
}

export function transitionTo(
  channelId: string,
  messageTs: string,
  newState: IssueState
): IssueState {
  setIssueState(channelId, messageTs, newState)
  return newState
}
