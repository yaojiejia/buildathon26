"""
API Service
-----------
Public-facing REST API that serves stock quotes.
  GET /quote?ticker=AAPL

Integrates with:
  - Price Store service  → source of truth for live prices
  - Redis                → caching layer with configurable TTL

Tracks cache hit / miss metrics exposed via GET /metrics.
"""

import json
import os
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Query

# ---------------------------------------------------------------------------
# Configuration (all overridable via env vars)
# ---------------------------------------------------------------------------
PRICE_STORE_URL = os.getenv("PRICE_STORE_URL", "http://localhost:8001")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "5"))
USE_FAKEREDIS = os.getenv("USE_FAKEREDIS", "false").lower() in ("1", "true", "yes")

# ---------------------------------------------------------------------------
# Shared clients
# ---------------------------------------------------------------------------
redis_client = None
http_client: httpx.AsyncClient | None = None

# ---------------------------------------------------------------------------
# Simple in-process metrics counters
# ---------------------------------------------------------------------------
metrics = {
    "cache_hits": 0,
    "cache_misses": 0,
    "total_requests": 0,
    "errors": 0,
}

# ---------------------------------------------------------------------------
# App lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client, http_client

    # --- Redis (real or fake) ------------------------------------------------
    if USE_FAKEREDIS:
        import fakeredis.aioredis
        redis_client = fakeredis.aioredis.FakeRedis(decode_responses=True)
        print("[api] Using fakeredis (in-process, no external Redis needed)")
    else:
        import redis.asyncio as aioredis
        redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
        print(f"[api] Connected to Redis at {REDIS_URL}")

    http_client = httpx.AsyncClient(timeout=5.0)
    print(f"[api] Price store URL: {PRICE_STORE_URL}")
    print(f"[api] Cache TTL: {CACHE_TTL_SECONDS}s")
    yield

    await http_client.aclose()
    await redis_client.aclose()


app = FastAPI(title="Quote API Service", lifespan=lifespan)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _fetch_from_store(ticker: str) -> dict:
    """Call the Price Store service for the latest price."""
    assert http_client is not None
    try:
        resp = await http_client.get(
            f"{PRICE_STORE_URL}/price", params={"ticker": ticker}
        )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Price store service unavailable",
        )
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail=f"Ticker '{ticker}' not found")
    resp.raise_for_status()
    return resp.json()

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/quote")
async def get_quote(ticker: str = Query(..., description="Stock ticker symbol")):
    """
    Return a quote for *ticker*.

    Response:
        ticker      – normalised ticker symbol
        price       – latest (or cached) price
        timestamp   – unix epoch when the price was recorded
        cache_hit   – whether the value came from Redis
    """
    ticker = ticker.upper()
    metrics["total_requests"] += 1

    # 1. Try Redis cache
    try:
        cached = await redis_client.get(f"quote:{ticker}")
    except Exception:
        cached = None
        metrics["errors"] += 1

    if cached is not None:
        metrics["cache_hits"] += 1
        data = json.loads(cached)
        return {
            "ticker": data["ticker"],
            "price": data["price"],
            "timestamp": data["timestamp"],
            "cache_hit": True,
        }

    # 2. Cache miss → fetch from price-store
    metrics["cache_misses"] += 1
    data = await _fetch_from_store(ticker)

    # 3. Store in Redis with TTL
    try:
        await redis_client.setex(
            f"quote:{ticker}",
            CACHE_TTL_SECONDS,
            json.dumps(data),
        )
    except Exception:
        metrics["errors"] += 1  # non-fatal; we still return the price

    return {
        "ticker": data["ticker"],
        "price": data["price"],
        "timestamp": data["timestamp"],
        "cache_hit": False,
    }


@app.get("/metrics")
async def get_metrics():
    """Return cache hit / miss counters and derived hit rate."""
    total = metrics["cache_hits"] + metrics["cache_misses"]
    return {
        **metrics,
        "cache_hit_rate": round(metrics["cache_hits"] / total, 4) if total else 0.0,
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
    }
