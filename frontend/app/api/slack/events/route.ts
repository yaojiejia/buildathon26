import { NextResponse } from "next/server"
import { verifySlackSignature } from "@/lib/slack"
import {
  postBlocksInThread,
  buildSlackCaseBlocks,
  type SlackCasePayload,
} from "@/lib/slack"
import { prisma } from "@/lib/db"
import { recordInitialState } from "@/lib/case-state-machine"
import { recordIssueCreated } from "@/lib/issue-state"

type SlackEvent = {
  type: string
  user?: string
  text?: string
  ts?: string
  channel?: string
  thread_ts?: string
  bot_id?: string
}

type SlackEventsPayload = {
  type: "url_verification" | "event_callback"
  challenge?: string
  event?: SlackEvent
  event_id?: string
}

const MAX_TITLE_LEN = 200
const MAX_SUMMARY_LEN = 500

/** Strip bot mention like <@U123ABC> from message text. */
function stripBotMention(text: string, botUserId?: string): string {
  let out = text.trim()
  // Remove <@U123> style mentions (optionally only our bot)
  out = out.replace(/<@([A-Z0-9]+)>/g, (match, id) => {
    if (botUserId && id !== botUserId) return match
    return ""
  })
  return out.replace(/\s+/g, " ").trim()
}

/**
 * Parse message for GitHub issue reference: #123 or owner/repo#123 or full URL.
 * Returns { repo, issueNumber } or null.
 */
function parseIssueRef(
  text: string,
  defaultRepo: string | null
): { repo: string; issueNumber: number } | null {
  // Full URL: https://github.com/owner/repo/issues/123
  const urlMatch = text.match(
    /github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/i
  )
  if (urlMatch) {
    return { repo: urlMatch[1], issueNumber: parseInt(urlMatch[2], 10) }
  }
  // owner/repo#123
  const repoHashMatch = text.match(/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)#(\d+)/)
  if (repoHashMatch) {
    return {
      repo: repoHashMatch[1],
      issueNumber: parseInt(repoHashMatch[2], 10),
    }
  }
  // #123 (use default repo from env)
  const hashMatch = text.match(/#(\d+)/)
  if (hashMatch && defaultRepo) {
    return {
      repo: defaultRepo,
      issueNumber: parseInt(hashMatch[1], 10),
    }
  }
  return null
}

async function handleAppMention(event: SlackEvent): Promise<void> {
  const channel = event.channel
  const user = event.user
  const text = event.text ?? ""
  const ts = event.ts ?? ""
  const threadTs = event.thread_ts ?? ts

  console.log("[Slack events] handleAppMention", { channel, user, ts, text: text.slice(0, 80) })

  if (!channel || !ts) {
    console.warn("[Slack events] app_mention missing channel or ts", event)
    return
  }

  const defaultRepo = process.env.GITHUB_DEFAULT_REPO?.trim() ?? null
  const messageText = stripBotMention(text)
  const issueRef = parseIssueRef(messageText, defaultRepo)

  const title =
    messageText.slice(0, MAX_TITLE_LEN) ||
    "Slack case"
  const summary =
    messageText.length > MAX_SUMMARY_LEN
      ? messageText.slice(0, MAX_SUMMARY_LEN) + "…"
      : messageText || "No description."

  let caseRecord: {
    id: string
    repo: string | null
    githubIssueId: number | null
    githubIssueUrl: string | null
  }

  if (issueRef) {
    const repoFullName = issueRef.repo
    const githubIssueUrl = `https://github.com/${repoFullName}/issues/${issueRef.issueNumber}`
    try {
      caseRecord = await prisma.case.create({
        data: {
          repo: repoFullName,
          githubIssueId: issueRef.issueNumber,
          githubIssueUrl,
          title,
          body: messageText || undefined,
          state: "NEW",
          sourceType: "slack",
          slackUserId: user ?? undefined,
          slackChannelId: channel,
          slackThreadTs: threadTs,
          slackMessageText: messageText || undefined,
        },
      })
      await recordInitialState(caseRecord.id)
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code
      if (code === "P2002") {
        const existing = await prisma.case.findFirst({
          where: { repo: repoFullName, githubIssueId: issueRef.issueNumber },
        })
        if (existing) {
          await prisma.case.update({
            where: { id: existing.id },
            data: {
              slackChannelId: channel,
              slackThreadTs: threadTs,
              slackUserId: user ?? undefined,
              slackMessageText: messageText || undefined,
            },
          })
          caseRecord = existing
        } else {
          throw e
        }
      } else {
        throw e
      }
    }
  } else {
    caseRecord = await prisma.case.create({
      data: {
        repo: null,
        githubIssueId: null,
        title,
        body: messageText || undefined,
        state: "NEW",
        sourceType: "slack",
        slackUserId: user ?? undefined,
        slackChannelId: channel,
        slackThreadTs: threadTs,
        slackMessageText: messageText || undefined,
      },
    })
    await recordInitialState(caseRecord.id)
  }

  recordIssueCreated(channel, threadTs)

  const payload: SlackCasePayload = {
    caseId: caseRecord.id,
    title,
    summary,
    repoLink: caseRecord.repo
      ? `https://github.com/${caseRecord.repo}`
      : null,
    hasGithubIssue: caseRecord.githubIssueId != null,
  }
  const blocks = buildSlackCaseBlocks(payload)
  await postBlocksInThread(
    channel,
    threadTs,
    blocks,
    `Case created: ${title}`
  )

  console.log("[Slack events] case created from app_mention", {
    caseId: caseRecord.id,
    channel,
    threadTs,
    hasGithubIssue: caseRecord.githubIssueId != null,
  })
}

/**
 * POST /api/slack/events
 * Slack Event Subscriptions: url_verification and app_mention (TICKET-1.3).
 * Configure in Slack app: Event Subscriptions → Request URL = this endpoint.
 * Subscribe to bot events: app_mention.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get("x-slack-signature")
  const requestTimestamp = request.headers.get("x-slack-request-timestamp")

  const skipVerify = process.env.SKIP_SLACK_SIGNATURE_VERIFY === "1"
  const valid =
    skipVerify ||
    verifySlackSignature(
      Buffer.from(rawBody, "utf8"),
      signature,
      requestTimestamp
    )
  if (!valid) {
    console.warn("[Slack events] 401 Invalid signature")
    return new NextResponse("Invalid signature", { status: 401 })
  }

  let payload: SlackEventsPayload
  try {
    payload = JSON.parse(rawBody) as SlackEventsPayload
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (payload.type === "url_verification") {
    const challenge = payload.challenge
    if (typeof challenge !== "string") {
      return NextResponse.json({ error: "Missing challenge" }, { status: 400 })
    }
    return NextResponse.json({ challenge })
  }

  if (payload.type === "event_callback") {
    const event = payload.event
    if (!event) {
      return NextResponse.json({ error: "Missing event" }, { status: 400 })
    }
    console.log("[Slack events] event_callback", event.type, event.channel, event.ts)
    if (event.type === "app_mention") {
      void handleAppMention(event).catch((err) => {
        console.error("[Slack events] handleAppMention failed", err)
      })
    }
    return new NextResponse()
  }

  return new NextResponse()
}
