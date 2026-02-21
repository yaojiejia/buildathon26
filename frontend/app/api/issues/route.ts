import { NextResponse } from "next/server"
import { postIssueToSlack } from "@/lib/slack"
import { recordIssueCreated } from "@/lib/issue-state"

export type CreateIssueBody = {
  title: string
  summary: string
  repoLink: string
  repoFullName?: string
}

/**
 * POST /api/issues
 * Create an issue and post summary to Slack (one thread per case).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateIssueBody
    const { title, summary, repoLink, repoFullName } = body

    if (!title || !summary || !repoLink) {
      return NextResponse.json(
        { error: "Missing required fields: title, summary, repoLink" },
        { status: 400 }
      )
    }

    const result = await postIssueToSlack({
      title,
      summary,
      repoLink,
      repoFullName,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? "Slack post failed" },
        { status: 502 }
      )
    }

    if (result.channel && result.ts) {
      recordIssueCreated(result.channel, result.ts)
    }

    return NextResponse.json({
      ok: true,
      channel: result.channel,
      thread_ts: result.ts,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
