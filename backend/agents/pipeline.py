"""
LangGraph Pipeline — orchestrates agents: Triage → Codebase Search → Log Analysis.

Uses LangGraph StateGraph to define a DAG of agent nodes.
Each node receives the shared state, runs its agent, and updates state.

Flow:
  START → triage_node → codebase_search_node → log_analysis_node → report_node → END

The event emitter is passed through state so each agent can emit
real-time status updates to the frontend (or console).
"""

import json
from typing import Any, TypedDict

from langgraph.graph import StateGraph, START, END

from llm import get_default_model
from triage_agent import triage_issue
from codebase_search_agent import search_codebase
from doc_agent import analyze_docs
from log_agent import analyze_logs
from patch_agent import generate_patch
from events import (
    EventEmitter,
    get_default_emitter,
    AGENT_PIPELINE,
    EVENT_STATUS,
    EVENT_PROGRESS,
    EVENT_RESULT,
)


# ── Pipeline State ───────────────────────────────────────────────

class PipelineState(TypedDict, total=False):
    """Shared state flowing through the pipeline."""
    # Input
    issue_title: str
    issue_body: str
    repo_url: str
    repo_name: str
    model: str
    num_questions: int  # Optional: number of investigation questions for codebase search
    clone_dir: str  # Optional: pre-existing local directory for the codebase
    force_reindex: bool  # Optional: force Nia to re-index the repo
    slack_source: str  # Optional: Nia data source name/id for Slack search
    enable_patch_agent: bool  # Optional: run patch generation agent

    # Event emitter (not serializable — runtime only)
    emitter: Any  # EventEmitter instance

    # Output from triage
    triage_result: dict

    # Output from codebase search
    search_result: dict

    # Output from documentation analysis
    doc_result: dict

    # Output from log analysis
    log_result: dict

    # Output from patch generation
    patch_result: dict

    # Final combined report
    report: dict


# ── Agent Nodes ──────────────────────────────────────────────────

def triage_node(state: PipelineState) -> dict:
    """Run the Triage Agent on the issue."""
    em: EventEmitter = state.get("emitter") or get_default_emitter()

    em.emit(AGENT_PIPELINE, EVENT_STATUS, "triage",
            "─" * 58)
    em.emit(AGENT_PIPELINE, EVENT_STATUS, "triage",
            "Pipeline → Running Triage Agent")
    em.emit(AGENT_PIPELINE, EVENT_STATUS, "triage",
            "─" * 58)

    result = triage_issue(
        issue_title=state["issue_title"],
        issue_body=state.get("issue_body", ""),
        repo_name=state.get("repo_name", ""),
        model=state.get("model") or get_default_model(),
        emitter=em,
    )

    em.emit(AGENT_PIPELINE, EVENT_PROGRESS, "triage",
            "Triage Agent finished")

    return {"triage_result": result}


def codebase_search_node(state: PipelineState) -> dict:
    """Run the Codebase Search Agent, informed by triage output."""
    em: EventEmitter = state.get("emitter") or get_default_emitter()

    em.emit(AGENT_PIPELINE, EVENT_STATUS, "codebase_search",
            "─" * 58)
    em.emit(AGENT_PIPELINE, EVENT_STATUS, "codebase_search",
            "Pipeline → Running Codebase Search Agent")
    em.emit(AGENT_PIPELINE, EVENT_STATUS, "codebase_search",
            "─" * 58)

    result = search_codebase(
        issue_title=state["issue_title"],
        issue_body=state.get("issue_body", ""),
        repo_url=state["repo_url"],
        repo_name=state.get("repo_name", ""),
        triage_result=state.get("triage_result"),
        model=state.get("model") or get_default_model(),
        num_questions=state.get("num_questions", 5),
        clone_dir=state.get("clone_dir"),
        force_reindex=state.get("force_reindex", False),
        emitter=em,
    )

    em.emit(AGENT_PIPELINE, EVENT_PROGRESS, "codebase_search",
            "Codebase Search Agent finished")

    return {"search_result": result}


def log_analysis_node(state: PipelineState) -> dict:
    """Run the Log Analysis Agent, querying Sentry for related logs."""
    em: EventEmitter = state.get("emitter") or get_default_emitter()

    em.emit(AGENT_PIPELINE, EVENT_STATUS, "log_analysis",
            "─" * 58)
    em.emit(AGENT_PIPELINE, EVENT_STATUS, "log_analysis",
            "Pipeline → Running Log Analysis Agent")
    em.emit(AGENT_PIPELINE, EVENT_STATUS, "log_analysis",
            "─" * 58)

    result = analyze_logs(
        issue_title=state["issue_title"],
        issue_body=state.get("issue_body", ""),
        triage_result=state.get("triage_result"),
        search_result=state.get("search_result"),
        model=state.get("model") or get_default_model(),
        emitter=em,
    )

    em.emit(AGENT_PIPELINE, EVENT_PROGRESS, "log_analysis",
            "Log Analysis Agent finished")

    return {"log_result": result}


def doc_analysis_node(state: PipelineState) -> dict:
    """Run the Documentation Agent to rank relevant markdown docs."""
    em: EventEmitter = state.get("emitter") or get_default_emitter()

    em.emit(AGENT_PIPELINE, EVENT_STATUS, "doc_analysis",
            "─" * 58)
    em.emit(AGENT_PIPELINE, EVENT_STATUS, "doc_analysis",
            "Pipeline → Running Documentation Agent")
    em.emit(AGENT_PIPELINE, EVENT_STATUS, "doc_analysis",
            "─" * 58)

    result = analyze_docs(
        issue_title=state["issue_title"],
        issue_body=state.get("issue_body", ""),
        repo_url=state["repo_url"],
        repo_name=state.get("repo_name", ""),
        triage_result=state.get("triage_result"),
        model=state.get("model") or get_default_model(),
        clone_dir=state.get("clone_dir"),
        force_reindex=state.get("force_reindex", False),
        slack_source=state.get("slack_source", ""),
        emitter=em,
    )

    em.emit(AGENT_PIPELINE, EVENT_PROGRESS, "doc_analysis",
            "Documentation Agent finished")

    return {"doc_result": result}


def patch_generation_node(state: PipelineState) -> dict:
    """Run Patch Generation Agent using all prior analysis context."""
    em: EventEmitter = state.get("emitter") or get_default_emitter()

    if not state.get("enable_patch_agent", False):
        em.emit(AGENT_PIPELINE, EVENT_PROGRESS, "patch_generation",
                "Patch Generation Agent skipped (enable_patch_agent=False)")
        return {"patch_result": {"status": "skipped", "reason": "disabled"}}

    em.emit(AGENT_PIPELINE, EVENT_STATUS, "patch_generation",
            "─" * 58)
    em.emit(AGENT_PIPELINE, EVENT_STATUS, "patch_generation",
            "Pipeline → Running Patch Generation Agent")
    em.emit(AGENT_PIPELINE, EVENT_STATUS, "patch_generation",
            "─" * 58)

    result = generate_patch(
        issue_title=state["issue_title"],
        issue_body=state.get("issue_body", ""),
        repo_url=state["repo_url"],
        repo_name=state.get("repo_name", ""),
        triage_result=state.get("triage_result"),
        search_result=state.get("search_result"),
        doc_result=state.get("doc_result"),
        log_result=state.get("log_result"),
        model=state.get("model") or get_default_model(),
        clone_dir=state.get("clone_dir"),
        emitter=em,
    )

    em.emit(AGENT_PIPELINE, EVENT_PROGRESS, "patch_generation",
            "Patch Generation Agent finished")
    return {"patch_result": result}


def report_node(state: PipelineState) -> dict:
    """Combine triage + search into a final investigation report."""
    em: EventEmitter = state.get("emitter") or get_default_emitter()

    triage = state.get("triage_result", {})
    search = state.get("search_result", {})
    docs = state.get("doc_result", {})
    logs = state.get("log_result", {})
    patch = state.get("patch_result", {})

    report = {
        "issue": {
            "title": state["issue_title"],
            "body": state.get("issue_body", ""),
            "repo": state.get("repo_name", ""),
        },
        "triage": triage,
        "investigation": search,
        "documentation": docs,
        "log_analysis": logs,
        "patch_generation": patch,
    }

    em.emit(AGENT_PIPELINE, EVENT_RESULT, "report",
            "Final report assembled", {
                "severity": triage.get("severity", "unknown"),
                "suspect_files": len(search.get("suspect_files", [])),
                "relevant_docs": len(docs.get("relevant_docs", [])),
                "confidence": search.get("confidence", "unknown"),
                "suspicious_logs": len(logs.get("suspicious_logs", [])),
                "log_patterns": len(logs.get("patterns_found", [])),
                "patch_status": patch.get("status", "skipped"),
            })

    return {"report": report}


# ── Graph Definition ─────────────────────────────────────────────

def build_pipeline() -> Any:
    """Build and compile the LangGraph pipeline.

    Returns a compiled graph that can be invoked with:
      result = pipeline.invoke({
          "issue_title": "...",
          "issue_body": "...",
          "repo_url": "https://github.com/...",
          "repo_name": "owner/repo",
          "emitter": ConsoleEventEmitter(),  # optional
      })
    """
    graph = StateGraph(PipelineState)

    # Add nodes
    graph.add_node("triage", triage_node)
    graph.add_node("codebase_search", codebase_search_node)
    graph.add_node("doc_analysis", doc_analysis_node)
    graph.add_node("log_analysis", log_analysis_node)
    graph.add_node("patch_generation", patch_generation_node)
    graph.add_node("report", report_node)

    # Define edges: START → triage → codebase_search → doc_analysis → log_analysis → patch_generation → report → END
    graph.add_edge(START, "triage")
    graph.add_edge("triage", "codebase_search")
    graph.add_edge("codebase_search", "doc_analysis")
    graph.add_edge("doc_analysis", "log_analysis")
    graph.add_edge("log_analysis", "patch_generation")
    graph.add_edge("patch_generation", "report")
    graph.add_edge("report", END)

    return graph.compile()


# Singleton for easy import
pipeline = build_pipeline()
