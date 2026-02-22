"""
API routes for the order management system.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from models import get_db, Product, Customer, Order, PromoCode
from services import place_order, process_refund

router = APIRouter(prefix="/api")


# ── Pydantic schemas ─────────────────────────────────────────────

class OrderItemIn(BaseModel):
    product_id: int
    quantity: int


class PlaceOrderIn(BaseModel):
    customer_id: int
    items: list[OrderItemIn]
    promo_code: str | None = None


class RefundIn(BaseModel):
    order_id: int


# ── Products ──────────────────────────────────────────────────────

@router.get("/products")
def list_products(db: Session = Depends(get_db)):
    products = db.query(Product).all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "price": p.price,
            "stock": p.stock,
        }
        for p in products
    ]


# ── Customers ─────────────────────────────────────────────────────

@router.get("/customers")
def list_customers(db: Session = Depends(get_db)):
    customers = db.query(Customer).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "email": c.email,
            "loyalty_points": c.loyalty_points,
            "loyalty_tier": c.loyalty_tier,
        }
        for c in customers
    ]


@router.get("/customers/{customer_id}")
def get_customer(customer_id: int, db: Session = Depends(get_db)):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {
        "id": customer.id,
        "name": customer.name,
        "email": customer.email,
        "loyalty_points": customer.loyalty_points,
        "loyalty_tier": customer.loyalty_tier,
    }


# ── Orders ────────────────────────────────────────────────────────

@router.post("/orders")
def create_order(body: PlaceOrderIn, db: Session = Depends(get_db)):
    try:
        order = place_order(
            db=db,
            customer_id=body.customer_id,
            items=[item.model_dump() for item in body.items],
            promo_code_str=body.promo_code,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "id": order.id,
        "customer_id": order.customer_id,
        "status": order.status,
        "subtotal": order.subtotal,
        "discount_amount": order.discount_amount,
        "total": order.total,
        "promo_code_used": order.promo_code_used,
        "items": [
            {
                "product_id": item.product_id,
                "quantity": item.quantity,
                "price_at_purchase": item.price_at_purchase,
            }
            for item in order.items
        ],
    }


@router.get("/orders")
def list_orders(customer_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(Order)
    if customer_id:
        query = query.filter(Order.customer_id == customer_id)
    orders = query.all()

    return [
        {
            "id": o.id,
            "customer_id": o.customer_id,
            "status": o.status,
            "subtotal": o.subtotal,
            "discount_amount": o.discount_amount,
            "total": o.total,
            "refund_amount": o.refund_amount,
            "promo_code_used": o.promo_code_used,
            "created_at": o.created_at.isoformat() if o.created_at else None,
        }
        for o in orders
    ]


@router.get("/orders/{order_id}")
def get_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    return {
        "id": order.id,
        "customer_id": order.customer_id,
        "status": order.status,
        "subtotal": order.subtotal,
        "discount_amount": order.discount_amount,
        "total": order.total,
        "promo_code_used": order.promo_code_used,
        "items": [
            {
                "product_id": item.product_id,
                "quantity": item.quantity,
                "price_at_purchase": item.price_at_purchase,
            }
            for item in order.items
        ],
    }


# ── Refunds ───────────────────────────────────────────────────────

@router.post("/refunds")
def refund_order(body: RefundIn, db: Session = Depends(get_db)):
    try:
        result = process_refund(db=db, order_id=body.order_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


# ── Promo Codes ───────────────────────────────────────────────────

@router.get("/promo-codes")
def list_promo_codes(db: Session = Depends(get_db)):
    codes = db.query(PromoCode).filter(PromoCode.is_active == True).all()
    return [
        {
            "id": c.id,
            "code": c.code,
            "discount_percent": c.discount_percent,
            "min_order_amount": c.min_order_amount,
        }
        for c in codes
    ]

