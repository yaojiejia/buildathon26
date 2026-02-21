"""
ShopEasy — a simple order management system (FastAPI).

Run:
    cd business_case
    pip install -r requirements.txt
    python main.py

Set SENTRY_DSN in business_case/.env to enable Sentry error tracking.
"""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from this directory
load_dotenv(Path(__file__).parent / ".env")

# Configure Python logging so logger.info() etc. actually output
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from models import init_db, SessionLocal, Product, Customer, PromoCode
from routes import router

# ── Sentry ────────────────────────────────────────────────────────

SENTRY_DSN = os.environ.get("SENTRY_DSN", "")

if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[
            FastApiIntegration(),
            SqlalchemyIntegration(),
            LoggingIntegration(
                level=logging.INFO,      # INFO+ captured as breadcrumbs
                event_level=logging.INFO, # INFO+ also sent as Sentry events
            ),
        ],
        traces_sample_rate=1.0,        # capture 100% of transactions
        profiles_sample_rate=0.5,      # profile 50% of sampled transactions
        environment=os.environ.get("SENTRY_ENVIRONMENT", "development"),
        send_default_pii=True,         # attach user IP / headers for debugging
    )
    print(f"✓ Sentry initialized (env={os.environ.get('SENTRY_ENVIRONMENT', 'development')})")
else:
    print("⚠ SENTRY_DSN not set — Sentry disabled")

app = FastAPI(title="ShopEasy", version="0.1.0")
app.include_router(router)


# ── Seed data ─────────────────────────────────────────────────────

def seed():
    """Insert demo data if the database is empty."""
    db = SessionLocal()
    try:
        if db.query(Product).count() > 0:
            return  # already seeded

        products = [
            Product(name="Wireless Headphones", description="Noise-cancelling, 30h battery", price=79.99, stock=50),
            Product(name="USB-C Hub", description="7-in-1 dock, 4K HDMI", price=34.99, stock=120),
            Product(name="Mechanical Keyboard", description="Cherry MX Blue, RGB", price=129.99, stock=30),
            Product(name="Laptop Stand", description="Aluminum, adjustable height", price=49.99, stock=75),
            Product(name="Webcam 1080p", description="Auto-focus, built-in mic", price=59.99, stock=60),
        ]
        db.add_all(products)

        customers = [
            Customer(name="Alice Johnson", email="alice@example.com", loyalty_points=0, loyalty_tier="bronze"),
            Customer(name="Bob Smith", email="bob@example.com", loyalty_points=600, loyalty_tier="silver"),
            Customer(name="Carol Lee", email="carol@example.com", loyalty_points=1200, loyalty_tier="gold"),
        ]
        db.add_all(customers)

        promos = [
            PromoCode(code="SAVE10", discount_percent=10.0, min_order_amount=50.0),
            PromoCode(code="WELCOME20", discount_percent=20.0, min_order_amount=0.0),
            PromoCode(code="VIP15", discount_percent=15.0, min_order_amount=100.0),
        ]
        db.add_all(promos)

        db.commit()
        print("✓ Seeded database with products, customers, and promo codes")
    finally:
        db.close()


# ── Serve frontend ────────────────────────────────────────────────

TEMPLATES_DIR = Path(__file__).parent / "templates"


@app.get("/", response_class=HTMLResponse)
def index():
    return (TEMPLATES_DIR / "index.html").read_text()


# ── Startup ───────────────────────────────────────────────────────

@app.on_event("startup")
def on_startup():
    init_db()
    seed()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

