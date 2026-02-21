#!/usr/bin/env node
/**
 * Post an issue summary to Slack (no frontend or Next.js server required).
 * Usage: node scripts/post-issue-to-slack.mjs "Issue title" "Short summary" "https://github.com/owner/repo"
 *
 * Loads env from .env.local in frontend directory. Requires: SLACK_BOT_TOKEN, SLACK_CHANNEL_ID.
 */

import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")
const envPath = join(root, ".env.local")

if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf8")
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
  }
}

const token = process.env.SLACK_BOT_TOKEN
const channel = process.env.SLACK_CHANNEL_ID
if (!token || !channel) {
  console.error("Missing SLACK_BOT_TOKEN or SLACK_CHANNEL_ID. Set in frontend/.env.local")
  process.exit(1)
}

const title = process.argv[2] || "Issue created"
const summary = process.argv[3] || "No summary provided."
const repoLink = process.argv[4] || "https://github.com/username/repo"

const cursorOpenUrl =
  process.env.CURSOR_OPEN_URL ||
  `https://cursor.com/open?url=${encodeURIComponent(repoLink)}`

const blocks = [
  { type: "header", text: { type: "plain_text", text: title, emoji: true } },
  { type: "section", text: { type: "mrkdwn", text: summary } },
  {
    type: "section",
    text: { type: "mrkdwn", text: `<${repoLink}|View repository>` },
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

const res = await fetch("https://slack.com/api/chat.postMessage", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ channel, text: title, blocks }),
})
const data = await res.json()

if (!data.ok) {
  console.error("Slack error:", data.error || res.statusText)
  process.exit(1)
}
console.log("Slack thread created. Channel:", data.channel, "ts:", data.ts)
