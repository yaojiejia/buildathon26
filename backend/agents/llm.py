"""
LLM abstraction layer — supports Claude (Anthropic) and NVIDIA Nemotron (NIM).

Usage:
    from llm import call_llm, get_default_model

    response = call_llm(
        system="You are a helpful assistant.",
        user_msg="What is 2+2?",
        model=get_default_model(),
    )

Configuration (via .env or environment):
    LLM_PROVIDER=nvidia          # "anthropic" or "nvidia" (default: nvidia)
    NVIDIA_API_KEY=nvapi-...     # required if provider is nvidia
    ANTHROPIC_API_KEY=sk-ant-... # required if provider is anthropic

Supported models:
    - nvidia/llama-3.1-nemotron-70b-instruct  (NVIDIA NIM)
    - claude-opus-4-5                           (Anthropic)
"""

import os

# ── Provider detection ────────────────────────────────────────────

PROVIDER_NVIDIA = "nvidia"
PROVIDER_ANTHROPIC = "anthropic"

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
DEFAULT_NVIDIA_MODEL = "nvidia/llama-3.3-nemotron-super-49b-v1"
DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-5"


def get_provider() -> str:
    """Return the configured LLM provider ('nvidia' or 'anthropic')."""
    return os.environ.get("LLM_PROVIDER", PROVIDER_NVIDIA).strip().lower()


def get_default_model() -> str:
    """Return the default model for the configured provider."""
    provider = get_provider()
    if provider == PROVIDER_NVIDIA:
        return os.environ.get("NVIDIA_MODEL", DEFAULT_NVIDIA_MODEL)
    return os.environ.get("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)


# ── Unified call ──────────────────────────────────────────────────

def call_llm(system: str, user_msg: str, model: str | None = None, max_tokens: int = 4096) -> str:
    """Call the configured LLM and return the text response.

    Automatically routes to Anthropic or NVIDIA based on LLM_PROVIDER
    (or auto-detects from the model name).

    Returns:
        Raw text response (markdown fences stripped if present).
    """
    model = model or get_default_model()
    provider = get_provider()

    # Convenience for NVIDIA users: allow shorthand model names like
    # "llama-3.1-405b-instruct" by auto-prefixing "meta/".
    if provider == PROVIDER_NVIDIA and "/" not in model and not model.startswith("claude"):
        model = f"meta/{model}"

    # Auto-detect provider from model name if not explicitly set
    if model.startswith("claude") or model.startswith("anthropic"):
        raw = _call_anthropic(system, user_msg, model, max_tokens)
    elif model.startswith("nvidia/") or model.startswith("meta/") or model.startswith("mistralai/"):
        raw = _call_nvidia(system, user_msg, model, max_tokens)
    else:
        # Fall back to configured provider
        if provider == PROVIDER_NVIDIA:
            raw = _call_nvidia(system, user_msg, model, max_tokens)
        else:
            raw = _call_anthropic(system, user_msg, model, max_tokens)

    # Strip markdown fences — handle fences anywhere in the response
    raw = _strip_markdown_fences(raw)

    return raw


def _strip_markdown_fences(text: str) -> str:
    """Remove markdown code fences (```json ... ```) from LLM output.

    Handles fences at the start, middle, or end of text.  Returns the
    content inside the *first* fenced block if one exists, otherwise
    returns the original text.
    """
    import re
    # Match ```<optional lang>\n ... ``` anywhere in the text
    m = re.search(r"```(?:\w+)?\s*\n(.*?)```", text, re.DOTALL)
    if m:
        return m.group(1).strip()
    # Fallback: if it starts with ``` (no closing)
    if text.startswith("```"):
        return text.split("\n", 1)[1].strip()
    return text


# ── Anthropic (Claude) ────────────────────────────────────────────

def _call_anthropic(system: str, user_msg: str, model: str, max_tokens: int) -> str:
    """Call Claude via the Anthropic SDK."""
    import anthropic

    client = anthropic.Anthropic()  # uses ANTHROPIC_API_KEY env var
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user_msg}],
    )
    return response.content[0].text.strip()


# ── NVIDIA NIM (Nemotron, etc.) ──────────────────────────────────

def _call_nvidia(system: str, user_msg: str, model: str, max_tokens: int) -> str:
    """Call NVIDIA NIM via the OpenAI-compatible API."""
    from openai import OpenAI

    api_key = os.environ.get("NVIDIA_API_KEY", "")
    if not api_key:
        raise ValueError(
            "NVIDIA_API_KEY not set. Get one from https://build.nvidia.com/ "
            "and add it to your .env file."
        )

    client = OpenAI(
        base_url=NVIDIA_BASE_URL,
        api_key=api_key,
    )

    response = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.2,  # lower temp for structured output
    )

    return response.choices[0].message.content.strip()
