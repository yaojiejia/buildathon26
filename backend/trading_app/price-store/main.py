"""
Price Store Service
-------------------
In-memory map of stock tickers with prices that update every 100ms
via a random walk. Exposes an HTTP API so the API service can fetch
the latest price for any ticker.
"""

import asyncio
import time
import random
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query

# ---------------------------------------------------------------------------
# In-memory ticker store
# ---------------------------------------------------------------------------
SEED_TICKERS: dict[str, float] = {
    "AAPL": 189.50,
    "GOOGL": 141.25,
    "MSFT": 378.90,
    "AMZN": 178.10,
    "TSLA": 248.60,
    "META": 474.30,
    "NVDA": 820.50,
    "JPM": 183.20,
    "V": 275.40,
    "JNJ": 156.80,
    "WMT": 165.30,
    "PG": 158.90,
    "MA": 450.10,
    "UNH": 527.60,
    "HD": 352.40,
    "DIS": 111.70,
    "BAC": 33.80,
    "XOM": 104.50,
    "KO": 59.20,
    "PFE": 27.40,
}

# Mutable runtime state
prices: dict[str, float] = {}
last_updated: dict[str, float] = {}

# ---------------------------------------------------------------------------
# Random-walk logic
# ---------------------------------------------------------------------------
WALK_VOLATILITY = 0.001  # max ±0.1 % per tick
UPDATE_INTERVAL = 0.1    # 100 ms


def _random_walk(price: float) -> float:
    """Apply a small random perturbation to *price*."""
    delta = price * random.uniform(-WALK_VOLATILITY, WALK_VOLATILITY)
    new_price = round(price + delta, 2)
    return max(new_price, 0.01)  # prices never go to zero


async def _price_updater() -> None:
    """Background task: update every ticker every 100 ms."""
    while True:
        now = time.time()
        for ticker in list(prices):
            prices[ticker] = _random_walk(prices[ticker])
            last_updated[ticker] = now
        await asyncio.sleep(UPDATE_INTERVAL)

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed prices
    now = time.time()
    for ticker, seed_price in SEED_TICKERS.items():
        prices[ticker] = seed_price
        last_updated[ticker] = now

    # Start background updater
    task = asyncio.create_task(_price_updater())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Price Store Service", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "tickers_loaded": len(prices)}


@app.get("/price")
async def get_price(ticker: str = Query(..., description="Stock ticker symbol")):
    """Return the latest price for *ticker*."""
    ticker = ticker.upper()
    if ticker not in prices:
        raise HTTPException(status_code=404, detail=f"Ticker '{ticker}' not found")
    return {
        "ticker": ticker,
        "price": prices[ticker],
        "timestamp": last_updated[ticker],
    }


@app.get("/tickers")
async def list_tickers():
    """Return all tracked tickers and their current prices."""
    return {
        "tickers": [
            {"ticker": t, "price": prices[t], "timestamp": last_updated[t]}
            for t in sorted(prices)
        ]
    }

