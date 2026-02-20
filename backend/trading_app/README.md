# Trading App

A single-server trading-style API that exposes a `/quote` endpoint returning live stock prices. The application and the in-memory price store run as **two separate containers**, with **Redis** as the caching layer in between.

## Architecture

```
┌──────────────────────┐         ┌──────────────────────┐
│   trading_app-api    │────────▶│ trading_app-price-    │
│   (port 8000)        │◀────────│ store (port 8001)     │
│                      │         │                       │
│  GET /quote          │         │  In-memory ticker map │
│  GET /metrics        │         │  Random walk @ 100ms  │
│  GET /health         │         │  GET /price           │
│                      │         │  GET /tickers         │
└──────────┬───────────┘         └───────────────────────┘
           │
           │  cache read/write
           ▼
┌──────────────────────┐
│  trading_app-redis   │
│  (port 6379)         │
│  TTL-based caching   │
└──────────────────────┘
```

## Containers

| Container | Description | Port |
|---|---|---|
| `trading_app-price-store` | In-memory price store with 20 seeded tickers. Prices update every 100ms via random walk. | `8001` |
| `trading_app-api` | Public REST API. Queries the price store, caches results in Redis, tracks hit/miss metrics. | `8000` |
| `trading_app-redis` | Redis 7 (Alpine). Caching layer with configurable TTL. | `6379` |

## Quick Start

### Docker Compose (recommended)

```bash
cd backend/trading_app
docker compose up --build -d
```

### Local Development (no Docker needed)

Uses `fakeredis` as an in-process Redis replacement:

```bash
cd backend/trading_app
bash run_dev.sh
```

> **Dependencies for local dev:** `pip install fastapi uvicorn httpx redis fakeredis`

## API Reference

### `GET /quote?ticker=AAPL`

Returns a stock quote with caching information.

**Response:**
```json
{
  "ticker": "AAPL",
  "price": 189.52,
  "timestamp": 1771619933.627,
  "cache_hit": false
}
```

| Field | Type | Description |
|---|---|---|
| `ticker` | string | Normalised ticker symbol |
| `price` | float | Latest (or cached) stock price |
| `timestamp` | float | Unix epoch when the price was recorded |
| `cache_hit` | boolean | `true` if served from Redis cache |

### `GET /metrics`

Returns cache hit/miss counters and derived statistics.

**Response:**
```json
{
  "cache_hits": 12,
  "cache_misses": 5,
  "total_requests": 17,
  "errors": 0,
  "cache_hit_rate": 0.7059,
  "cache_ttl_seconds": 5
}
```

### `GET /health`

Health check for the API service.

### Price Store Internal Endpoints

| Endpoint | Description |
|---|---|
| `GET /price?ticker=AAPL` | Returns the latest price for a single ticker |
| `GET /tickers` | Returns all tracked tickers with current prices |
| `GET /health` | Health check for the price store |

## Configuration

All settings are configurable via environment variables:

| Variable | Default | Description |
|---|---|---|
| `PRICE_STORE_URL` | `http://price-store:8001` | URL of the price store service |
| `REDIS_URL` | `redis://redis:6379/0` | Redis connection string |
| `CACHE_TTL_SECONDS` | `5` | How long cached prices live in Redis (seconds) |
| `USE_FAKEREDIS` | `false` | Use in-process fake Redis (for local dev) |

## Supported Tickers

20 pre-seeded tickers with realistic starting prices:

`AAPL` `GOOGL` `MSFT` `AMZN` `TSLA` `META` `NVDA` `JPM` `V` `JNJ` `WMT` `PG` `MA` `UNH` `HD` `DIS` `BAC` `XOM` `KO` `PFE`

Prices drift continuously via a random walk (±0.1% per 100ms tick), simulating live market movement with no external data dependency.

## Stopping

```bash
docker compose down
```

