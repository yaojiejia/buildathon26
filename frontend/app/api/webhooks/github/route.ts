import { NextResponse } from "next/server"
import { verifyGitHubSignature } from "@/lib/github-webhook"
import { postIssueToSlack } from "@/lib/slack"
import { recordIssueCreated } from "@/lib/issue-state"
import { prisma } from "@/lib/db"
import { recordInitialState } from "@/lib/case-state-machine"

const MAX_SUMMARY_LEN = 500

type GitHubIssuesPayload = {
  action?: string
  issue?: {
    number?: number
    id?: number
    title?: string
    body?: string | null
    html_url?: string
  }
  repository?: {
    html_url?: string
    full_name?: string
  }
  repo?: {
    html_url?: string
    full_name?: string
  }
}

/** Log event for acceptance criteria (event processing logged). */
function logWebhookEvent(
  event: string | null,
  payload: Record<string, unknown>,
  message: string
) {
  const action = payload.action ?? "(no action)"
  const repo = (payload.repository as { full_name?: string } | undefined)?.full_name ?? "?"
  const issueNum = (payload.issue as { number?: number } | undefined)?.number
  const logPayload = issueNum != null ? { event, action, repo, issue: issueNum } : { event, action, repo }
  console.log("[GitHub webhook]", message, JSON.stringify(logPayload))
}

/**
 * POST /api/webhooks/github
 * Receives GitHub App / webhook events: issues, pull_request, issue_comment, check_run, workflow_run.
 * - Verifies X-Hub-Signature-256
 * - Logs event payload
 * - On issues.opened: creates case in DB and posts to Slack
 */
export async function POST(request: Request) {
  const rawBody = await request.arrayBuffer()
  const rawBuffer = Buffer.from(rawBody)
  const signature = request.headers.get("x-hub-signature-256")
  const event = request.headers.get("x-github-event")

  console.log("[GitHub webhook] request received", { event, hasSignature: !!signature })

  if (!verifyGitHubSignature(rawBuffer, signature)) {
    console.warn("[GitHub webhook] 401 Invalid signature")
    return new NextResponse("Invalid signature", { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBuffer.toString("utf8")) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  logWebhookEvent(event ?? null, payload, "received")

  switch (event) {
    case "issues": {
      const issuesPayload = payload as GitHubIssuesPayload
      if (issuesPayload.action !== "opened") {
        logWebhookEvent(event, payload, "ignored (not opened)")
        return NextResponse.json({ received: true })
      }
      const issue = issuesPayload.issue
      const repo =
        (issuesPayload.repository as GitHubIssuesPayload["repository"]) ??
        (issuesPayload.repo as GitHubIssuesPayload["repository"])
      const issueNumber =
        issue.number != null
          ? Number(issue.number)
          : issue.id != null
            ? Number(issue.id)
            : null
      if (!issue?.title || !repo?.html_url || issueNumber == null || !Number.isInteger(issueNumber)) {
        console.warn("[GitHub webhook] 400 Missing issue/repo", {
          hasIssue: !!issue,
          hasRepo: !!repo,
          issueTitle: issue?.title,
          repoHtmlUrl: repo?.html_url,
          issueNumber: issue?.number,
          issueId: issue?.id,
        })
        return NextResponse.json({ error: "Missing issue or repository" }, { status: 400 })
      }
      const title = issue.title
      const body = issue.body?.trim() ?? null
      const summary =
        body != null && body.length > MAX_SUMMARY_LEN
          ? body.slice(0, MAX_SUMMARY_LEN) + "…"
          : body ?? "No description."
      const repoLink = repo.html_url
      const repoFullName = repo.full_name ?? repoLink

      const slackResult = await postIssueToSlack({
        title,
        summary,
        repoLink,
        repoFullName,
      })

      if (!slackResult.ok) {
        return NextResponse.json(
          { error: slackResult.error ?? "Slack post failed" },
          { status: 502 }
        )
      }

      try {
        const caseRecord = await prisma.case.create({
          data: {
            githubIssueId: issueNumber,
            repo: repoFullName,
            title,
            body: body ?? undefined,
            state: "NEW",
            slackChannelId: slackResult.channel ?? undefined,
            slackThreadTs: slackResult.ts ?? undefined,
          },
        })
        await recordInitialState(caseRecord.id)
        logWebhookEvent(event, payload, "case created: " + caseRecord.id)
      } catch (dbError: unknown) {
        const code = (dbError as { code?: string })?.code
        if (code === "P2002") {
          logWebhookEvent(event, payload, "case already exists (duplicate)")
        } else {
          console.error("[GitHub webhook] DB create failed", dbError)
          return NextResponse.json(
            { error: "Failed to create case record" },
            { status: 500 }
          )
        }
      }

      if (slackResult.channel && slackResult.ts) {
        recordIssueCreated(slackResult.channel, slackResult.ts)
      }

      return NextResponse.json({
        ok: true,
        channel: slackResult.channel,
        thread_ts: slackResult.ts,
      })
    }

    case "pull_request": {
      logWebhookEvent(event, payload, "processed (pull_request)")
      return NextResponse.json({ received: true })
    }
    case "issue_comment": {
      logWebhookEvent(event, payload, "processed (issue_comment)")
      return NextResponse.json({ received: true })
    }
    case "check_run": {
      logWebhookEvent(event, payload, "processed (check_run)")
      return NextResponse.json({ received: true })
    }
    case "workflow_run": {
      logWebhookEvent(event, payload, "processed (workflow_run)")
      return NextResponse.json({ received: true })
    }

    default:
      logWebhookEvent(event ?? null, payload, "ignored (unknown event)")
      return NextResponse.json({ received: true })
  }
}
