# Slack app setup

This app posts an issue summary to Slack when an issue is created, with one thread per case and working buttons.

## 1. Create a Slack app

1. Go to [Slack API – Create app](https://api.slack.com/apps) → **Create New App** → **From scratch**.
2. Name the app (e.g. "Issue Notifier") and pick a workspace.

## 2. Bot token and permissions

1. In the app: **OAuth & Permissions**.
2. Under **Scopes** → **Bot Token Scopes**, add:
   - `chat:write`
   - `chat:write.public` (if you want to post without joining the channel)
3. **Install to Workspace** and copy the **Bot User OAuth Token** (`xoxb-...`).

## 3. Interactivity (for buttons)

1. In the app: **Interactivity & Shortcuts** → turn **Interactivity** On.
2. **Request URL**: your public base URL + `/api/slack/interactions`, e.g.:
   - Production: `https://your-domain.com/api/slack/interactions`
   - Local: use [ngrok](https://ngrok.com/) and set `https://your-ngrok-id.ngrok.io/api/slack/interactions`
3. Save.

## 4. Signing secret

1. In the app: **Basic Information** → **App Credentials**.
2. Copy **Signing Secret**.

## 5. Environment variables

In the **frontend** project, copy `.env.example` to `.env.local` and set:

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_CHANNEL_ID=C0123456789    # channel ID (right‑click channel → View channel details)
SLACK_SIGNING_SECRET=your-signing-secret
```

Get the channel ID: open the channel in Slack → right‑click → **View channel details** → copy the ID at the bottom.

## 6. Invite the bot

In Slack, go to the channel and run:

```
/invite @YourAppName
```

## Message and buttons

When an issue is created (e.g. after analysis completes on the Analyze page), the app:

- Posts one message per issue (thread root) with:
  - **Issue title**
  - **Short summary**
  - **Repo link**
- Adds three buttons:
  - **Investigate** – posts in thread: "Investigation started"
  - **Assign Human** – posts in thread: "A human has been assigned"
  - **Open in Cursor** – opens the repo (or `CURSOR_OPEN_URL` if set)

All follow-up replies use the same thread (thread per case).

## API

- **POST `/api/issues`**  
  Body: `{ "title", "summary", "repoLink" }`  
  Creates the Slack thread with the issue summary and buttons.

- **POST `/api/slack/interactions`**  
  Called by Slack when a button is clicked; verifies signature and posts the reply in the thread.

## Testing

**Post issue (no server):** from `frontend/` run  
`node scripts/post-issue-to-slack.mjs "Title" "Summary" "https://github.com/owner/repo"`

**Post via API:** with server running,  
`curl -X POST http://localhost:3000/api/issues -H "Content-Type: application/json" -d '{"title":"Test","summary":"Summary","repoLink":"https://github.com/x/y"}'`

**Buttons:** run `npm run dev` and ngrok, set Interactivity URL in Slack, then click Investigate / Assign Human (replies in thread) and Open in Cursor (opens repo).
