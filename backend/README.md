# BugPilot — Backend Agents

BugPilot is an AI-powered bug investigation pipeline. Given a GitHub issue, it automatically triages severity, searches the codebase for the root cause, and produces a structured investigation report with suspect files, line numbers, and reasoning.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    LangGraph Pipeline                    │
│                                                         │
│  START → [Triage Agent] → [Codebase Search Agent] → END │
│              │                     │                    │
│              ▼                     ▼                    │
│         Claude API            Claude API + Nia          │
│                                                         │
│  Event Emitter ─── streams status to consumer ─── ▶ UI  │
└─────────────────────────────────────────────────────────┘
```

### Agents

| Agent | Purpose | Input | Output |
|-------|---------|-------|--------|
| **Triage Agent** | Classify severity, identify likely module, detect duplicates, generate summary | Issue title + body | `{ severity, likely_module, is_duplicate, summary }` |
| **Codebase Search Agent** | Investigate codebase, find root cause files + line numbers | Issue + triage result + repo URL | `{ suspect_files[], reasoning, confidence }` |

### Codebase Search Workflow

1. **Claude generates questions** — 3-5 targeted investigation questions + grep patterns from the bug report
2. **Nia collects evidence** — each question is sent to [Nia](https://app.trynia.ai) (or answered locally via Claude for local directories) to find concrete code evidence
3. **Claude generates report** — all evidence is analyzed to produce the final investigation report with suspect files, line numbers, and reasoning

### Event System

Both agents emit structured events as they work, enabling real-time status updates for any consumer (CLI, WebSocket, frontend):

```json
{
  "agent": "triage | codebase_search | pipeline",
  "type": "status | progress | result | error | log",
  "step": "calling_claude | nia_indexing | collecting_evidence | ...",
  "message": "Human-readable status message",
  "data": {},
  "timestamp": 1234567890.123
}
```

Three emitter implementations:
- `ConsoleEventEmitter` — colored terminal output (default)
- `CallbackEventEmitter` — forwards events to a callback (for WebSocket/SSE)
- `NoOpEventEmitter` — silent

1. In the app: **Basic Information** → **App Credentials**.
2. Copy **Signing Secret** (not "Client Secret"). Paste into `.env.local` with no extra spaces or newlines.

## Setup

### 1. Create virtual environment

```bash
cd backend/agents
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure API keys

Create `backend/.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
NIA_API_KEY=nk_your-nia-key-here        # optional — enables Nia for GitHub repos
```

- **`ANTHROPIC_API_KEY`** (required) — get from [console.anthropic.com](https://console.anthropic.com/)
- **`NIA_API_KEY`** (optional) — get from [app.trynia.ai](https://app.trynia.ai/home). Enables codebase intelligence for GitHub repos. Without it, local file search + Claude is used as fallback.

### 3. (Optional) Run the business_case app

```bash
cd business_case
pip install -r requirements.txt
python main.py
# → http://localhost:8000
```

## Usage

### Run with the business_case app (local)

```bash
cd backend/agents
source venv/bin/activate
python example/run_pipeline.py
```

This runs against the `business_case/` FastAPI app using the default `both_bugs` scenario.

### Run against a GitHub repo (with Nia)

- Posts one message per issue (thread root) with:
  - **Issue title**
  - **Short summary**
  - **Repo link**
- Adds three buttons:
  - **Investigate** – transition to `INVESTIGATING`; thread gets status update
  - **Assign Human** – transition to `NEEDS_HUMAN`; thread gets status update
  - **Open in Cursor** – generates a handoff artifact (issue title, summary, repo + Open in Cursor link) and posts it in the thread

If `NIA_API_KEY` is set, Nia will index the repo and answer investigation questions with full codebase context.

### Custom issue

```bash
python example/run_pipeline.py \
  --title "Login crashes on mobile" \
  --body "Blank page on iOS Safari when tapping login button" \
  --repo-url "https://github.com/your-org/your-repo" \
  --repo-name "your-org/your-repo"
```

### Available test scenarios

```bash
python example/run_pipeline.py --list-scenarios
```

| Scenario | Description |
|----------|-------------|
| `discount_stacking` | Loyalty + promo code applied together instead of picking the larger one |
| `refund_wrong_amount` | Refund uses current product price instead of price-at-purchase |
| `both_bugs` | Both business logic bugs combined (default) |

### CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--scenario` | `both_bugs` | Built-in test scenario |
| `--title` | *(from scenario)* | Custom issue title |
| `--body` | *(from scenario)* | Custom issue body |
| `--repo-url` | *(local business_case)* | GitHub repo URL |
| `--repo-name` | `shopeasy/order-mgmt` | Human-readable repo name |
| `--model` | `claude-sonnet-4-20250514` | Claude model to use |

## The Two Business Logic Bugs

The `business_case/services.py` file contains two deliberate business logic bugs:

### Bug 1 — Discount Stacking (`calculate_discount`)
The docstring says *"apply whichever discount is LARGER (not both)"*, but the code applies the loyalty discount first and then the promo code discount on the already-reduced amount. Both discounts stack.

### Bug 2 — Refund Wrong Amount (`process_refund`)
The docstring says *"refund amount should be the TOTAL that the customer actually paid"*, but the code recalculates the refund by looking up each product's **current** price instead of using `order.total` or `item.price_at_purchase`. If prices change, the refund is wrong.

## Output

The pipeline produces a JSON report with three sections:

```json
{
  "issue": {
    "title": "Multiple business logic issues in order and refund system",
    "body": "...",
    "repo": "shopeasy/order-mgmt"
  },
  "triage": {
    "severity": "high",
    "likely_module": "services",
    "is_duplicate": false,
    "summary": "Two business logic bugs in discount calculation and refund processing..."
  },
  "investigation": {
    "suspect_files": [
      {
        "file_path": "services.py",
        "why_relevant": "Contains both bugs in calculate_discount and process_refund",
        "lines_referenced": [48, 49, 50, 51, 52, 158, 159, 160],
        "snippet": "..."
      }
    ],
    "reasoning": "...",
    "confidence": "high"
  }
}
```

## Frontend Integration

When a frontend is ready, swap the event emitter to push real-time status updates:

```python
from events import CallbackEventEmitter

def send_to_frontend(event: dict):
    # e.g. WebSocket, SSE, or queue
    websocket.send(json.dumps(event))

emitter = CallbackEventEmitter(send_to_frontend)

pipeline.invoke({
    "issue_title": "...",
    "issue_body": "...",
    "repo_url": "https://github.com/...",
    "repo_name": "owner/repo",
    "emitter": emitter,
})
```

The frontend receives structured events for each agent step — triage starting, Claude calling, Nia indexing, evidence collection, report generation, etc.
