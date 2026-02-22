# Distributed Systems Agent — Frontend

Next.js app: web UI, Slack integration, GitHub webhooks, and case state machine (Prisma + SQLite).

## Running the project (after cloning)

### 1. Install dependencies

```bash
cd frontend
npm install
```

### 2. Environment variables

- **`.env`** (required for DB) — Prisma reads this. Create it from the example:
  ```bash
  cp .env.example .env
  ```
  Default `DATABASE_URL="file:./dev.db"` is fine for local development.

- **`.env.local`** (optional) — Slack and GitHub webhook secrets. Copy from example and fill in what you use:
  ```bash
  cp .env.example .env.local
  ```
  | Variable | Required for | Where to get it |
  |----------|--------------|------------------|
  | `SLACK_BOT_TOKEN` | Posting to Slack, button actions | Slack app → OAuth & Permissions → Bot User OAuth Token |
  | `SLACK_CHANNEL_ID` | Posting to Slack | Channel ID from Slack (right‑click channel → Copy link) |
  | `SLACK_SIGNING_SECRET` | Verifying Slack button clicks | Slack app → Basic Information → Signing Secret |
  | `GITHUB_WEBHOOK_SECRET` | Receiving GitHub issue events | See [GitHub App / webhook setup](#github-app--webhook-setup) below |

  You can run the app without these; Slack/GitHub features will fail until they’re set.

#### GitHub App / webhook setup

To have **new GitHub issues** create a case in the DB and post to Slack, GitHub must send webhooks to your app. Use either a **repository webhook** (one repo) or a **GitHub App** (multiple repos or app features).

**Option A — Repository webhook (simplest for one repo)**

1. In your repo: **Settings** → **Webhooks** → **Add webhook**.
2. **Payload URL:** `https://<your-public-host>/api/webhooks/github`  
   For local dev, expose your server (e.g. [ngrok](https://ngrok.com)) and use `https://<your-ngrok-subdomain>.ngrok.io/api/webhooks/github`.
3. **Content type:** `application/json`.
4. **Secret:** Generate a random string (e.g. `openssl rand -hex 32`). Put the **same value** in `GITHUB_WEBHOOK_SECRET` in `.env.local`.
5. Under "Which events would you like to trigger this webhook?", choose **Let me select individual events** and check **Issues**. Save.

**Option B — GitHub App (multiple repos or app-level features)**

1. **GitHub** → **Settings** (or org settings) → **Developer settings** → **GitHub Apps** → **New GitHub App**.
2. **Webhook URL:** `https://<your-public-host>/api/webhooks/github` (use ngrok for local dev as above).
3. **Webhook secret:** Generate a random string; set the **same value** as `GITHUB_WEBHOOK_SECRET` in `.env.local`.
4. Under "Permissions & events", subscribe to **Issues** (read + write if you want the app to act on issues). Save.
5. **Install App** on the repo(s) you want. Events from those repos will POST to your webhook URL.

The app only acts on **issues.opened** (creates case, posts to Slack). Other events (e.g. `pull_request`, `issue_comment`) are accepted and logged but not processed.

#### Slack @mention — start a case from Slack (TICKET-1.3)

Users can start a BugPilot case by **@mentioning the app** in a channel or thread with a bug description. Optionally reference a GitHub issue (e.g. `#123` or `owner/repo#123`).

1. **Slack app** → **Event Subscriptions** → **Enable Events** → **Request URL:** `https://<your-public-host>/api/slack/events` (use ngrok for local dev).
2. Under **Subscribe to bot events**, add **app_mention**. Save.
3. Reinstall the app to the workspace if prompted.
4. Optional: set `GITHUB_DEFAULT_REPO=owner/repo` in `.env.local` so `#123` in the message resolves to that repo, and so the "Create GitHub issue" button can link to a new-issue URL.

When someone mentions the bot, the app creates a case (with `sourceType: "slack"`), stores the message and Slack user/channel/thread, and replies in the same thread with action buttons (Investigate, Assign Human, Create GitHub issue if no issue linked, etc.). The case appears in the dashboard and the thread is the timeline.

### 3. Database

```bash
npx prisma generate
npx prisma db push
```

This creates the SQLite DB and tables (e.g. `dev.db` in `frontend/prisma/`).

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Tech stack

- **Next.js 14** — App Router, API routes
- **TypeScript** — Type safety
- **Tailwind CSS** — Styling
- **shadcn/ui** — UI components (Radix UI)
- **Prisma** — SQLite for cases and state transitions

## Project Structure

```
frontend/
├── app/              # Next.js App Router pages
│   ├── layout.tsx   # Root layout
│   ├── page.tsx     # Home page
│   └── globals.css  # Global styles
├── components/       # React components
│   └── ui/          # shadcn/ui components
├── lib/             # Utility functions
└── public/          # Static assets
```

## Available scripts

- `npm run dev` — Start development server
- `npm run build` — Build for production
- `npm run start` — Start production server
- `npm run lint` — Run ESLint
- `npm run db:push` — Push Prisma schema to the database (create/update tables)
- `npm run db:studio` — Open Prisma Studio to inspect/edit the DB

## UI Components

The project uses shadcn/ui components. To add more components, you can use the shadcn CLI or manually add them to `components/ui/`.
