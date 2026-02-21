/**
 * Slack API helpers: chat.postMessage and request verification.
 */

import crypto from "crypto"

const SLACK_API = "https://slack.com/api"

export type IssuePayload = {
  title: string
  summary: string
  repoLink: string
  repoFullName?: string
}

function getSlackConfig(): { token: string; channel?: string } {
  const token = process.env.SLACK_BOT_TOKEN
  const channel = process.env.SLACK_CHANNEL_ID ?? undefined
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN must be set")
  }
  return { token, channel }
}

/**
 * Build Block Kit blocks for an issue: header, summary, repo link, action buttons.
 */
export function buildIssueBlocks(payload: IssuePayload): Record<string, unknown>[] {
  const { title, summary, repoLink } = payload
  const cursorOpenUrl =
    process.env.CURSOR_OPEN_URL ||
    `https://cursor.com/open?url=${encodeURIComponent(repoLink)}`

  return [
    {
      type: "header",
      text: { type: "plain_text", text: title, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: summary },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `<${repoLink}|View repository>`,
      },
    },
    {
      type: "actions",
      block_id: "issue_actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Investigate", emoji: true },
          action_id: "investigate",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Assign Human", emoji: true },
          action_id: "assign_human",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Open in Cursor", emoji: true },
          action_id: "open_in_cursor",
          url: cursorOpenUrl,
        },
      ],
    },
    {
      type: "actions",
      block_id: "issue_actions_2",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Report ready", emoji: true },
          action_id: "report_ready",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "PR opened", emoji: true },
          action_id: "pr_opened",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Review completed", emoji: true },
          action_id: "review_completed",
        },
      ],
    },
  ]
}

/**
 * Post issue summary to Slack. Creates the parent message (thread root).
 * Returns { ok, channel, ts } so callers can post follow-ups in thread.
 */
export async function postIssueToSlack(
  payload: IssuePayload
): Promise<{ ok: boolean; channel?: string; ts?: string; error?: string }> {
  const { token, channel } = getSlackConfig()
  if (!channel) {
    return { ok: false, error: "SLACK_CHANNEL_ID must be set for postIssueToSlack" }
  }
  const blocks = buildIssueBlocks(payload)
  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel,
      text: payload.title,
      blocks,
    }),
  })
  const data = (await res.json()) as {
    ok: boolean
    channel?: string
    ts?: string
    error?: string
  }
  if (!data.ok) {
    return { ok: false, error: data.error ?? res.statusText }
  }
  return { ok: true, channel: data.channel, ts: data.ts }
}

/**
 * Post a reply in a Slack thread (for button actions).
 */
export async function postReplyInThread(
  channel: string,
  threadTs: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const { token } = getSlackConfig()
  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel,
      thread_ts: threadTs,
      text,
    }),
  })
  const data = (await res.json()) as { ok: boolean; error?: string }
  return { ok: data.ok, error: data.error }
}

/**
 * Post a status update in a thread (for TICKET-2.2 state changes).
 */
export async function postStatusInThread(
  channel: string,
  threadTs: string,
  status: string
): Promise<{ ok: boolean; error?: string }> {
  return postReplyInThread(channel, threadTs, `*Status:* ${status}`)
}

/** Format elapsed ms as "0m", "5m", "1h 2m", etc. */
export function formatTimeElapsed(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return "—"
  const sec = Math.floor(ms / 1000)
  const min = Math.floor(sec / 60)
  const hour = Math.floor(min / 60)
  if (hour > 0) return `${hour}h ${min % 60}m`
  if (min > 0) return `${min}m`
  return `${sec}s`
}

export type StatusUpdatePayload = {
  statusBadge: string
  confidenceScore: number | null
  timeElapsedMs: number | null
}

/**
 * Build Block Kit blocks for a timeline status update (badge + confidence + elapsed).
 */
export function buildStatusUpdateBlocks(payload: StatusUpdatePayload): Record<string, unknown>[] {
  const { statusBadge, confidenceScore, timeElapsedMs } = payload
  const confidence =
    confidenceScore != null ? `${confidenceScore}%` : "—"
  const elapsed =
    timeElapsedMs != null ? formatTimeElapsed(timeElapsedMs) : "—"
  return [
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `*${statusBadge}*` },
        { type: "mrkdwn", text: `Confidence: ${confidence}` },
        { type: "mrkdwn", text: `Elapsed: ${elapsed}` },
      ],
    },
  ]
}

/**
 * Post a timeline status update in the thread (TICKET-2.3).
 */
export async function postStatusUpdateInThread(
  channel: string,
  threadTs: string,
  payload: StatusUpdatePayload
): Promise<{ ok: boolean; error?: string }> {
  const blocks = buildStatusUpdateBlocks(payload)
  return postBlocksInThread(
    channel,
    threadTs,
    blocks,
    payload.statusBadge
  )
}

/**
 * Post message with blocks in a thread (e.g. handoff artifact).
 */
export async function postBlocksInThread(
  channel: string,
  threadTs: string,
  blocks: Record<string, unknown>[],
  textFallback: string
): Promise<{ ok: boolean; error?: string }> {
  const { token } = getSlackConfig()
  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel,
      thread_ts: threadTs,
      text: textFallback,
      blocks,
    }),
  })
  const data = (await res.json()) as { ok: boolean; error?: string }
  return { ok: data.ok, error: data.error }
}

export type HandoffContext = {
  title: string
  summary: string
  repoLink: string
}

/** Payload for Slack-initiated case (TICKET-1.3): reply in thread with case card + actions. */
export type SlackCasePayload = {
  caseId: string
  title: string
  summary: string
  repoLink?: string | null
  hasGithubIssue: boolean
}

/**
 * Build Block Kit blocks for a Slack-initiated case: header, summary, repo link (if any), actions.
 * If no GitHub issue linked, include "Create GitHub issue" button.
 */
export function buildSlackCaseBlocks(payload: SlackCasePayload): Record<string, unknown>[] {
  const { caseId, title, summary, repoLink, hasGithubIssue } = payload
  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 Case created: ${title}`, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: summary || "_No description._" },
    },
  ]
  if (repoLink) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `<${repoLink}|View repository>` },
    })
  }
  const cursorOpenUrl = repoLink
    ? (process.env.CURSOR_OPEN_URL || `https://cursor.com/open?url=${encodeURIComponent(repoLink)}`)
    : null
  const row1: Record<string, unknown>[] = [
    { type: "button", text: { type: "plain_text", text: "Investigate", emoji: true }, action_id: "investigate" },
    { type: "button", text: { type: "plain_text", text: "Assign Human", emoji: true }, action_id: "assign_human" },
  ]
  if (cursorOpenUrl) {
    row1.push({
      type: "button",
      text: { type: "plain_text", text: "Open in Cursor", emoji: true },
      action_id: "open_in_cursor",
      url: cursorOpenUrl,
    })
  }
  if (!hasGithubIssue) {
    row1.push({
      type: "button",
      text: { type: "plain_text", text: "Create GitHub issue", emoji: true },
      action_id: "create_github_issue",
      value: caseId,
    })
  }
  blocks.push({ type: "actions", block_id: "issue_actions", elements: row1 })
  blocks.push({
    type: "actions",
    block_id: "issue_actions_2",
    elements: [
      { type: "button", text: { type: "plain_text", text: "Report ready", emoji: true }, action_id: "report_ready" },
      { type: "button", text: { type: "plain_text", text: "PR opened", emoji: true }, action_id: "pr_opened" },
      { type: "button", text: { type: "plain_text", text: "Review completed", emoji: true }, action_id: "review_completed" },
    ],
  })
  return blocks
}

/**
 * Build Block Kit blocks for Open in Cursor handoff artifact.
 */
export function buildHandoffArtifactBlocks(ctx: HandoffContext): Record<string, unknown>[] {
  const cursorOpenUrl =
    process.env.CURSOR_OPEN_URL ||
    `https://cursor.com/open?url=${encodeURIComponent(ctx.repoLink)}`
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "📂 Handoff artifact – Open in Cursor", emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Issue:* ${ctx.title}` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: ctx.summary },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `<${ctx.repoLink}|View repository> · <${cursorOpenUrl}|Open in Cursor>`,
      },
    },
  ]
}

const FIVE_MINUTES_SEC = 5 * 60

/**
 * Verify Slack request signature (X-Slack-Signature).
 * Slack signs: base_string = "v0:" + timestamp + ":" + raw_body (timestamp from X-Slack-Request-Timestamp).
 */
export function verifySlackSignature(
  body: string | Buffer,
  signature: string | null,
  requestTimestamp: string | null
): boolean {
  const rawSecret = process.env.SLACK_SIGNING_SECRET
  const secret = rawSecret?.trim()
  const sig = signature?.trim()
  const ts = requestTimestamp?.trim()
  if (!secret || !sig || !sig.startsWith("v0=") || !ts) return false
  const tsNum = parseInt(ts, 10)
  if (Number.isNaN(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > FIVE_MINUTES_SEC) return false
  const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8")
  const baseString = "v0:" + ts + ":" + bodyBuf.toString("utf8")
  const sigBaseline = "v0=" + crypto.createHmac("sha256", secret).update(baseString, "utf8").digest("hex")
  const a = Buffer.from(sig, "utf8")
  const b = Buffer.from(sigBaseline, "utf8")
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b)
  if (!ok) {
    console.warn("[Slack signature] FAILED", "bodyLen=" + bodyBuf.length, "hasSig=" + !!sig, "secretLen=" + secret.length, "recv=" + sig.slice(0, 14) + "...", "comp=" + sigBaseline.slice(0, 14) + "...")
  }
  return ok
}
