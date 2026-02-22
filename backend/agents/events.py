"""
Event system for BugPilot agents.

Each agent emits structured events as it works, allowing any consumer
(CLI, WebSocket, SSE, frontend) to show real-time progress.

Event schema:
{
    "agent":     "triage" | "codebase_search" | "pipeline",
    "type":      "status" | "progress" | "result" | "error" | "log",
    "step":      "indexing" | "generating_questions" | "querying_nia" | ...,
    "message":   "Human-readable status message",
    "data":      { ... optional structured payload ... },
    "timestamp": 1234567890.123
}

Usage:
    emitter = ConsoleEventEmitter()          # prints to stdout
    emitter = CallbackEventEmitter(my_func)  # calls your function
    emitter = NoOpEventEmitter()             # silent

    emitter.emit("triage", "status", "analyzing_issue", "Analyzing issue severity...")
"""

from __future__ import annotations

import time
from typing import Any, Callable, Protocol


# ═══════════════════════════════════════════════════════════════════
#  EVENT TYPES
# ═══════════════════════════════════════════════════════════════════

# Agent identifiers
AGENT_TRIAGE = "triage"
AGENT_CODEBASE_SEARCH = "codebase_search"
AGENT_DOC = "doc_analysis"
AGENT_LOG = "log_analysis"
AGENT_PATCH = "patch_generation"
AGENT_PIPELINE = "pipeline"

# Event types
EVENT_STATUS = "status"       # Agent changed state (starting, step change)
EVENT_PROGRESS = "progress"   # Incremental progress within a step
EVENT_RESULT = "result"       # Agent produced a result
EVENT_ERROR = "error"         # Something went wrong
EVENT_LOG = "log"             # Verbose debug log line
EVENT_SUMMARY = "summary"    # Agent-level summary sent to frontend


# ═══════════════════════════════════════════════════════════════════
#  EVENT EMITTER PROTOCOL + IMPLEMENTATIONS
# ═══════════════════════════════════════════════════════════════════

class EventEmitter(Protocol):
    """Protocol for event emitters — any object with an emit() method."""

    def emit(
        self,
        agent: str,
        event_type: str,
        step: str,
        message: str,
        data: dict[str, Any] | None = None,
    ) -> None: ...


class ConsoleEventEmitter:
    """Prints events to the console with colored prefixes."""

    # ANSI colors for different agents
    _COLORS = {
        AGENT_TRIAGE: "\033[36m",        # cyan
        AGENT_CODEBASE_SEARCH: "\033[33m",  # yellow
        AGENT_DOC: "\033[34m",           # blue
        AGENT_LOG: "\033[32m",           # green
        AGENT_PATCH: "\033[96m",         # bright cyan
        AGENT_PIPELINE: "\033[35m",      # magenta
    }
    _RESET = "\033[0m"
    _BOLD = "\033[1m"
    _DIM = "\033[2m"

    # Icons for event types
    _ICONS = {
        EVENT_STATUS: "●",
        EVENT_PROGRESS: "→",
        EVENT_RESULT: "✓",
        EVENT_ERROR: "✗",
        EVENT_LOG: "·",
        EVENT_SUMMARY: "■",
    }

    def emit(
        self,
        agent: str,
        event_type: str,
        step: str,
        message: str,
        data: dict[str, Any] | None = None,
    ) -> None:
        color = self._COLORS.get(agent, "")
        icon = self._ICONS.get(event_type, " ")
        agent_label = agent.upper().replace("_", " ")

        if event_type == EVENT_SUMMARY:
            # Distinct block for agent summaries — the frontend would render these
            print(f"{color}{self._BOLD}  [{agent_label}] {icon} {message}{self._RESET}")
            if data:
                for key, value in data.items():
                    if isinstance(value, list):
                        for item in value:
                            print(f"{color}  [{agent_label}]   • {item}{self._RESET}")
                    else:
                        print(f"{color}  [{agent_label}]   {key}: {value}{self._RESET}")
        elif event_type == EVENT_STATUS:
            print(f"{color}{self._BOLD}  [{agent_label}] {icon} {message}{self._RESET}")
        elif event_type == EVENT_PROGRESS:
            print(f"{color}  [{agent_label}] {icon} {message}{self._RESET}")
        elif event_type == EVENT_RESULT:
            print(f"{color}{self._BOLD}  [{agent_label}] {icon} {message}{self._RESET}")
        elif event_type == EVENT_ERROR:
            print(f"\033[31m  [{agent_label}] {icon} {message}{self._RESET}")
        elif event_type == EVENT_LOG:
            print(f"{self._DIM}  [{agent_label}] {message}{self._RESET}")


class CallbackEventEmitter:
    """Forwards events to a callback function (for WebSocket/SSE/frontend).

    The callback receives a single dict with the full event payload.
    """

    def __init__(self, callback: Callable[[dict[str, Any]], None]) -> None:
        self._callback = callback

    def emit(
        self,
        agent: str,
        event_type: str,
        step: str,
        message: str,
        data: dict[str, Any] | None = None,
    ) -> None:
        event = {
            "agent": agent,
            "type": event_type,
            "step": step,
            "message": message,
            "data": data or {},
            "timestamp": time.time(),
        }
        self._callback(event)


class NoOpEventEmitter:
    """Silent emitter — discards all events."""

    def emit(
        self,
        agent: str,
        event_type: str,
        step: str,
        message: str,
        data: dict[str, Any] | None = None,
    ) -> None:
        pass


# ── Default singleton ─────────────────────────────────────────────
_default_emitter: EventEmitter = ConsoleEventEmitter()


def get_default_emitter() -> EventEmitter:
    """Get the default event emitter."""
    return _default_emitter


def set_default_emitter(emitter: EventEmitter) -> None:
    """Set the default event emitter globally."""
    global _default_emitter
    _default_emitter = emitter
