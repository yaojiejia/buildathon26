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

function getSlackConfig() {
  const token = process.env.SLACK_BOT_TOKEN
  const channel = process.env.SLACK_CHANNEL_ID
  if (!token || !channel) {
    throw new Error("SLACK_BOT_TOKEN and SLACK_CHANNEL_ID must be set")
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
