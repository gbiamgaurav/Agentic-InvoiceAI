from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum
from datetime import datetime


class InvoiceStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    pending_review = "pending_review"
    approved = "approved"
    rejected = "rejected"
    posted = "posted"
    error = "error"


class InvoiceSource(str, Enum):
    manual = "manual"
    email = "email"


class LineItem(BaseModel):
    desc: str
    qty: float
    unit: float
    amount: float
    conf: float = 0.0


class RuleViolation(BaseModel):
    rule_id: str
    severity: str  # "error" | "warning"
    message: str


class AgentTrace(BaseModel):
    agent: str
    status: str
    confidence: float = 0.0
    log: str = ""
    duration_ms: int = 0


class Invoice(BaseModel):
    id: str
    source: InvoiceSource = InvoiceSource.manual

    # File info
    file_name: str
    blob_url: Optional[str] = None
    blob_name: Optional[str] = None
    file_size_bytes: int = 0

    # Extracted header fields
    vendor: Optional[str] = None
    vendor_address: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    due_date: Optional[str] = None
    po_number: Optional[str] = None
    currency: str = "USD"

    # Financials
    subtotal: float = 0.0
    tax: float = 0.0
    tax_rate: float = 0.0
    total: float = 0.0

    # Processing state
    status: InvoiceStatus = InvoiceStatus.queued
    confidence: float = 0.0
    line_items: list[LineItem] = []
    rule_violations: list[RuleViolation] = []
    agent_traces: list[AgentTrace] = []

    # Review
    assigned_to: Optional[str] = None
    notes: Optional[str] = None
    concur_ref: Optional[str] = None

    # Email metadata (populated for email-sourced invoices)
    email_from: Optional[str] = None
    email_subject: Optional[str] = None

    # Timestamps
    received_at: datetime = Field(default_factory=datetime.utcnow)
    processed_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None

    correlation_id: Optional[str] = None


class InvoiceCreateRequest(BaseModel):
    uploaded_by: Optional[str] = None
    notes: Optional[str] = None


class InvoiceReviewRequest(BaseModel):
    action: str  # "approve" | "reject"
    notes: Optional[str] = None
    reviewed_by: Optional[str] = None


class EmailIngestRequest(BaseModel):
    email_from: str
    subject: Optional[str] = None
    received_at: Optional[str] = None
    attachments: list[dict] = []
