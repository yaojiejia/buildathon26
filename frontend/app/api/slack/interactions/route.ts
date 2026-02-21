import { NextResponse } from "next/server"
import {
  verifySlackSignature,
  postBlocksInThread,
  postStatusUpdateInThread,
  buildHandoffArtifactBlocks,
  type HandoffContext,
} from "@/lib/slack"
import { transitionTo, getIssueCreatedAt } from "@/lib/issue-state"

type SlackBlock = {
  type: string
  text?: { type: string; text?: string }
  elements?: unknown[]
}

type SlackInteractionPayload = {
  type: string
  channel?: { id: string }
  message?: { ts: string; blocks?: SlackBlock[] }
  actions?: Array<{ action_id: string; value?: string }>
}

/**
 * Parse issue context (title, summary, repoLink) from the original message blocks.
 */
function parseMessageContext(blocks: SlackBlock[] | undefined): HandoffContext | null {
  if (!blocks || !Array.isArray(blocks)) return null
  let title = "Issue"
  let summary = ""
  let repoLink = ""
  for (const block of blocks) {
    if (block.type === "header" && block.text?.text) {
      title = block.text.text
    }
    if (block.type === "section" && block.text?.text) {
      const t = block.text.text
      const linkMatch = t.match(/<([^|>]+)\|[^>]*>/)
      if (linkMatch) repoLink = linkMatch[1]
      else if (!summary) summary = t
    }
  }
  if (!repoLink) return null
  return { title, summary, repoLink }
}

/**
 * POST /api/slack/interactions
 * Handles interactive button payloads: state transition + Slack thread status update.
 * - Investigate → INVESTIGATING
 * - Assign Human → NEEDS_HUMAN
 * - Open in Cursor → generate handoff artifact
 */
export async function POST(request: Request) {
  const rawBodyBytes = await request.arrayBuffer()
  const rawBody = Buffer.from(rawBodyBytes)
  const signature = request.headers.get("x-slack-signature")
  const requestTimestamp = request.headers.get("x-slack-request-timestamp")

  const skipVerify = process.env.SKIP_SLACK_SIGNATURE_VERIFY === "1"
  const valid = skipVerify || verifySlackSignature(rawBody, signature, requestTimestamp)
  if (!valid) {
    console.warn("[interactions] 401 Invalid signature", "bodyLen=" + rawBody.length, "sig=" + (signature ? "present" : "MISSING"))
    return new NextResponse("Invalid signature", { status: 401 })
  }

  let payload: SlackInteractionPayload
  try {
    const params = new URLSearchParams(rawBody.toString("utf8"))
    const payloadStr = params.get("payload")
    if (!payloadStr) {
      return NextResponse.json({ error: "Missing payload" }, { status: 400 })
    }
    payload = JSON.parse(payloadStr) as SlackInteractionPayload
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  const channelId = payload.channel?.id
  const messageTs = payload.message?.ts
  const action = payload.actions?.[0]
  const blocks = payload.message?.blocks

  if (!channelId || !messageTs || !action) {
    return NextResponse.json({ error: "Missing channel, message or action" }, { status: 400 })
  }

  const actionId = action.action_id

  const postTimelineUpdate = async (
    state: "INVESTIGATING" | "REPORT_READY" | "PR_OPENED" | "REVIEW_COMPLETED" | "NEEDS_HUMAN",
    badge: string,
    confidence: number | null = null
  ) => {
    transitionTo(channelId, messageTs, state)
    const createdAt = getIssueCreatedAt(channelId, messageTs)
    const elapsed =
      createdAt != null ? Date.now() - createdAt : null
    const r = await postStatusUpdateInThread(channelId, messageTs, {
      statusBadge: badge,
      confidenceScore: confidence,
      timeElapsedMs: elapsed,
    })
    if (!r.ok) console.error("Slack status update failed:", r.error)
  }

  const run = async () => {
    switch (actionId) {
      case "investigate":
        await postTimelineUpdate("INVESTIGATING", "🔍 Investigation started")
        break
      case "assign_human":
        await postTimelineUpdate("NEEDS_HUMAN", "👤 Needs human")
        break
      case "report_ready":
        await postTimelineUpdate("REPORT_READY", "📋 Report ready", 85)
        break
      case "pr_opened":
        await postTimelineUpdate("PR_OPENED", "🔀 PR opened", 90)
        break
      case "review_completed":
        await postTimelineUpdate("REVIEW_COMPLETED", "✅ Review completed", 95)
        break
      case "open_in_cursor": {
        const ctx = parseMessageContext(blocks) ?? {
          title: "Issue",
          summary: "",
          repoLink: "https://github.com/owner/repo",
        }
        const handoffBlocks = buildHandoffArtifactBlocks(ctx)
        const r3 = await postBlocksInThread(
          channelId,
          messageTs,
          handoffBlocks,
          "Handoff artifact – Open in Cursor"
        )
        if (!r3.ok) console.error("Slack handoff post failed:", r3.error)
        break
      }
      default: {
        const createdAt = getIssueCreatedAt(channelId, messageTs)
        const elapsed = createdAt != null ? Date.now() - createdAt : null
        await postStatusUpdateInThread(channelId, messageTs, {
          statusBadge: "Action received.",
          confidenceScore: null,
          timeElapsedMs: elapsed,
        })
      }
    }
  }

  void run()

  return new NextResponse()
}
