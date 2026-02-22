import { NextResponse } from "next/server"
import { postStatusUpdateInThread } from "@/lib/slack"
import { transitionTo, getIssueCreatedAt } from "@/lib/issue-state"

const BADGE_BY_STATE: Record<string, string> = {
  INVESTIGATING: "🔍 Investigation ended",
  REPORT_READY: "📋 Report ready",
  PR_OPENED: "🔀 PR opened",
  REVIEW_COMPLETED: "✅ Review completed",
  NEEDS_HUMAN: "👤 Needs human",
}

export type StatusUpdateBody = {
  channelId: string
  threadTs: string
  state: keyof typeof BADGE_BY_STATE
  confidence?: number | null
}

/**
 * POST /api/issues/status
 * Post a timeline status update to an existing thread (e.g. from GitHub PR webhook).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as StatusUpdateBody
    const { channelId, threadTs, state, confidence } = body
    if (!channelId || !threadTs || !state || !BADGE_BY_STATE[state]) {
      return NextResponse.json(
        { error: "Missing or invalid channelId, threadTs, or state" },
        { status: 400 }
      )
    }
    transitionTo(channelId, threadTs, state)
    const createdAt = getIssueCreatedAt(channelId, threadTs)
    const elapsed = createdAt != null ? Date.now() - createdAt : null
    const result = await postStatusUpdateInThread(channelId, threadTs, {
      statusBadge: BADGE_BY_STATE[state],
      confidenceScore: confidence ?? null,
      timeElapsedMs: elapsed,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
