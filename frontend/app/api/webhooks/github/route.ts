import { NextResponse } from "next/server"
import { verifyGitHubSignature } from "@/lib/github-webhook"
import { postIssueToSlack } from "@/lib/slack"
import { recordIssueCreated } from "@/lib/issue-state"

const MAX_SUMMARY_LEN = 500

type GitHubIssuesPayload = {
  action?: string
  issue?: {
    title?: string
    body?: string | null
    html_url?: string
  }
  repository?: {
    html_url?: string
    full_name?: string
  }
}

/**
 * POST /api/webhooks/github
 * Receives GitHub webhook. On "issues" event with action "opened", posts the issue to Slack.
 */
export async function POST(request: Request) {
  const rawBody = await request.arrayBuffer()
  const rawBuffer = Buffer.from(rawBody)
  const signature = request.headers.get("x-hub-signature-256")

  if (!verifyGitHubSignature(rawBuffer, signature)) {
    return new NextResponse("Invalid signature", { status: 401 })
  }

  let payload: GitHubIssuesPayload
  try {
    payload = JSON.parse(rawBuffer.toString("utf8")) as GitHubIssuesPayload
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const event = request.headers.get("x-github-event")
  if (event !== "issues" || payload.action !== "opened") {
    return NextResponse.json({ received: true })
  }

  const issue = payload.issue
  const repo = payload.repository
  if (!issue?.title || !repo?.html_url) {
    return NextResponse.json({ error: "Missing issue or repository" }, { status: 400 })
  }

  const title = issue.title
  const body = issue.body?.trim() || ""
  const summary = body.length > MAX_SUMMARY_LEN
    ? body.slice(0, MAX_SUMMARY_LEN) + "…"
    : body || "No description."
  const repoLink = repo.html_url
  const repoFullName = repo.full_name

  const result = await postIssueToSlack({
    title,
    summary,
    repoLink,
    repoFullName,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Slack post failed" }, { status: 502 })
  }

  if (result.channel && result.ts) {
    recordIssueCreated(result.channel, result.ts)
  }

  return NextResponse.json({
    ok: true,
    channel: result.channel,
    thread_ts: result.ts,
  })
}
