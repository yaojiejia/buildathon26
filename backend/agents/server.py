"""
FastAPI server that exposes the BugPilot pipeline as an SSE endpoint.

Run:
    cd backend/agents
    source venv/bin/activate
    uvicorn server:app --reload --port 8000
"""

import asyncio
import json
import time
import threading
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Load .env from backend/ (one level up)
load_dotenv(dotenv_path=str(Path(__file__).resolve().parent.parent / ".env"))

from pipeline import pipeline
from events import CallbackEventEmitter

app = FastAPI(title="BugPilot Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class InvestigateRequest(BaseModel):
    issue_title: str
    issue_body: str = ""
    repo_url: str = ""
    repo_name: str = ""
    model: str = "claude-sonnet-4-20250514"


@app.post("/investigate")
async def investigate(req: InvestigateRequest):
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def on_event(event: dict):
        loop.call_soon_threadsafe(queue.put_nowait, event)

    emitter = CallbackEventEmitter(on_event)

    def run_pipeline():
        try:
            result = pipeline.invoke({
                "issue_title": req.issue_title,
                "issue_body": req.issue_body,
                "repo_url": req.repo_url,
                "repo_name": req.repo_name,
                "model": req.model,
                "emitter": emitter,
            })
            report = result.get("report", {})
            loop.call_soon_threadsafe(queue.put_nowait, {
                "agent": "pipeline",
                "type": "complete",
                "step": "done",
                "message": "Investigation complete",
                "data": {"report": report},
                "timestamp": time.time(),
            })
        except Exception as e:
            loop.call_soon_threadsafe(queue.put_nowait, {
                "agent": "pipeline",
                "type": "error",
                "step": "fatal",
                "message": f"Pipeline error: {e}",
                "data": {},
                "timestamp": time.time(),
            })
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    thread = threading.Thread(target=run_pipeline, daemon=True)
    thread.start()

    async def event_stream():
        while True:
            event = await queue.get()
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
