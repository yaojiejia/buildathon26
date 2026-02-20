#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Local development runner — starts both services as separate processes.
# No Docker or external Redis required (uses fakeredis).
#
# Usage:
#   cd backend && bash run_dev.sh
#
# Stop:
#   Ctrl-C (kills both processes)
# ---------------------------------------------------------------------------

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
    echo ""
    echo "[dev] Shutting down…"
    kill "$PID_STORE" "$PID_API" 2>/dev/null || true
    wait "$PID_STORE" "$PID_API" 2>/dev/null || true
    echo "[dev] Done."
}
trap cleanup EXIT INT TERM

echo "========================================"
echo "  Starting Price Store  (port 8001)"
echo "========================================"
python3 -m uvicorn main:app --host 0.0.0.0 --port 8001 --app-dir "$ROOT_DIR/price-store" &
PID_STORE=$!

# Give the price-store a moment to boot
sleep 1

echo "========================================"
echo "  Starting API Service  (port 8000)"
echo "========================================"
USE_FAKEREDIS=true \
PRICE_STORE_URL=http://localhost:8001 \
CACHE_TTL_SECONDS=5 \
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --app-dir "$ROOT_DIR/api" &
PID_API=$!

echo ""
echo "========================================"
echo "  Services running!"
echo "  Price Store : http://localhost:8001"
echo "  API (quote) : http://localhost:8000"
echo "  Try: curl http://localhost:8000/quote?ticker=AAPL"
echo "========================================"
echo ""

wait

