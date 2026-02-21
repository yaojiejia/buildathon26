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
 * Verify Slack request signature (X-Slack-Signature) using SLACK_SIGNING_SECRET.
 */
export function verifySlackSignature(
  body: string,
  signature: string | null
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET
  if (!secret || !signature || !signature.startsWith("v0=")) return false
  const sigBaseline = "v0=" + crypto.createHmac("sha256", secret).update(body).digest("hex")
  const a = Buffer.from(signature)
  const b = Buffer.from(sigBaseline)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
