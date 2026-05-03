"""
LangGraph shared state for the invoice processing graph.
agent_traces uses operator.add as reducer so every node appends its own trace
without clobbering traces written by parallel siblings.
"""
import operator
from typing import Annotated, TypedDict


class InvoiceState(TypedDict):
    # ── Input (cleared after ingestion) ──────────────────────────────────
    invoice_id: str
    file_bytes: bytes
    file_name: str
    source: str

    # ── Ingestion ─────────────────────────────────────────────────────────
    raw_text: str
    page_count: int

    # ── Header extraction (parallel with line_item) ───────────────────────
    vendor: str | None
    vendor_address: str | None
    bill_to: str | None
    bill_to_address: str | None
    invoice_number: str | None
    invoice_date: str | None
    due_date: str | None
    po_number: str | None
    currency: str
    subtotal: float
    tax: float
    tax_rate: float
    total: float

    # ── Line items (parallel with header_extractor) ───────────────────────
    line_items: list

    # ── Tax validation ────────────────────────────────────────────────────
    tax_validation_issues: list

    # ── Vendor matching ───────────────────────────────────────────────────
    vendor_matched: bool
    vendor_id: str | None
    vendor_canonical: str | None

    # ── Rule engine ───────────────────────────────────────────────────────
    rule_violations: list

    # list reducer: each node appends; parallel nodes never collide
    agent_traces: Annotated[list, operator.add]

    # ── Human review (populated by interrupt) ─────────────────────────────
    review_decision: str | None
    review_notes: str | None

    # ── Concur ────────────────────────────────────────────────────────────
    concur_ref: str | None

    # ── Final ─────────────────────────────────────────────────────────────
    status: str
    confidence: float
    error: str | None
