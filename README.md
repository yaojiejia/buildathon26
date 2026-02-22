# Buildathon 26

Bug investigation pipeline: GitHub issues → Slack notifications, case state machine, and (optional) AI agents.

## Quick start

The main app is a **Next.js frontend** that runs the web UI, API routes, Slack integration, and GitHub webhooks.

1. **Clone and enter the frontend**
   ```bash
   git clone <this-repo>
   cd buildathon26/frontend
   ```

2. **Follow [frontend/README.md](frontend/README.md)** for:
   - Environment variables (`.env` + `.env.local`)
   - Database setup (Prisma + SQLite)
   - Slack & GitHub webhook (optional for full features)
   - `npm install` and `npm run dev`

3. Open **http://localhost:3000**

## Repo layout

| Path | Description |
|------|-------------|
| **frontend/** | Next.js app (UI, APIs, Slack, GitHub webhook, Prisma DB). **This is what you run.** |
| **backend/** | Optional Python agents (triage, codebase search). See [backend/README.md](backend/README.md). |
