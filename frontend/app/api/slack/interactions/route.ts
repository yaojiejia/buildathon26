import { NextResponse } from "next/server"
import { verifySlackSignature, postReplyInThread } from "@/lib/slack"

type SlackInteractionPayload = {
  type: string
  user?: { id: string; username: string }
  channel?: { id: string }
  message?: { ts: string }
  actions?: Array<{ action_id: string; value?: string }>
}

/**
 * POST /api/slack/interactions
 * Handles Slack interactivity (button clicks). Verify signature, then run action and reply in thread.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get("x-slack-signature")

  if (!verifySlackSignature(rawBody, signature)) {
    return new NextResponse("Invalid signature", { status: 401 })
  }

  let payload: SlackInteractionPayload
  try {
    const params = new URLSearchParams(rawBody)
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

  if (!channelId || !messageTs || !action) {
    return NextResponse.json({ error: "Missing channel, message or action" }, { status: 400 })
  }

  const actionId = action.action_id
  let replyText: string

  switch (actionId) {
    case "investigate":
      replyText = "🔍 Investigation started. The team will look into this."
      break
    case "assign_human":
      replyText = "👤 A human has been assigned to this case."
      break
    case "open_in_cursor":
      replyText = "📂 Open the repository in Cursor from the link in the message above."
      break
    default:
      replyText = "Action received."
  }

  // Respond to Slack within 3s, then post reply in thread
  void postReplyInThread(channelId, messageTs, replyText).then((replyResult) => {
    if (!replyResult.ok) {
      console.error("Slack thread reply failed:", replyResult.error)
    }
  })

  return new NextResponse()
}
