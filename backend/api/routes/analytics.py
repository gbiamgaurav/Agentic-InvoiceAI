"""
Analytics routes — aggregated throughput metrics for the dashboard.
"""
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Query
from services.database import get_db

router = APIRouter(prefix="/analytics", tags=["analytics"])

APPROVED_STATUSES = {"approved", "posted"}


def _week_start_label(dt: datetime) -> str:
    """Return the Monday of the ISO week that dt falls in, as 'Apr 7'."""
    monday = dt - timedelta(days=dt.weekday())
    return monday.strftime("%-d %b")


@router.get("/throughput")
async def get_throughput(
    period: str = Query("weekly", pattern="^(daily|weekly|monthly)$"),
):
    """
    Returns processed vs approved invoice counts grouped by time bucket.

    period:
      daily   → last 7 calendar days, one bar per day
      weekly  → last 8 ISO weeks, one bar per week (labelled by Mon date)
      monthly → last 12 calendar months, one bar per month
    """
    db = get_db()
    now = datetime.utcnow()

    if period == "daily":
        n = 7
        start = now - timedelta(days=n)
        # Generate date keys and labels: oldest first
        dates = [(now - timedelta(days=n - 1 - i)) for i in range(n)]
        keys   = [d.strftime("%Y-%m-%d") for d in dates]
        labels = [d.strftime("%a")       for d in dates]
        def key_fn(dt: datetime) -> str:
            return dt.strftime("%Y-%m-%d")

    elif period == "weekly":
        n = 8
        start = now - timedelta(weeks=n)
        # ISO week key: e.g. "2025-W17"
        weeks  = [(now - timedelta(weeks=n - 1 - i)) for i in range(n)]
        keys   = [d.strftime("%G-W%V") for d in weeks]
        labels = [_week_start_label(d) for d in weeks]
        def key_fn(dt: datetime) -> str:
            return dt.strftime("%G-W%V")

    else:  # monthly
        n = 12
        # Build n month-start datetimes going back from current month
        months = []
        y, m = now.year, now.month
        for _ in range(n):
            months.insert(0, datetime(y, m, 1))
            m -= 1
            if m == 0:
                m = 12
                y -= 1
        start  = months[0]
        keys   = [d.strftime("%Y-%m")   for d in months]
        labels = [d.strftime("%b")       for d in months]
        def key_fn(dt: datetime) -> str:
            return dt.strftime("%Y-%m")

    cursor = db["invoices"].find(
        {"received_at": {"$gte": start}},
        {"received_at": 1, "status": 1, "_id": 0},
    )
    invoices = await cursor.to_list(10000)

    buckets: dict = defaultdict(lambda: {"processed": 0, "approved": 0})
    for inv in invoices:
        dt = inv.get("received_at")
        if not isinstance(dt, datetime):
            continue
        k = key_fn(dt)
        buckets[k]["processed"] += 1
        if inv.get("status") in APPROVED_STATUSES:
            buckets[k]["approved"] += 1

    data = [
        {
            "label":     labels[i],
            "processed": buckets[keys[i]]["processed"],
            "approved":  buckets[keys[i]]["approved"],
        }
        for i in range(n)
    ]
    return {"period": period, "data": data}
