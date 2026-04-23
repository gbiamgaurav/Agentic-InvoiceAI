"""
Invoice Processing Pipeline — runs all agents in sequence.
Each agent receives the shared context dict and merges its output back in.
"""
from datetime import datetime
from models.invoice import InvoiceStatus
from agents.ingestion_agent import IngestionAgent
from agents.header_extractor import HeaderExtractorAgent
from agents.line_item_agent import LineItemAgent
from agents.tax_validator import TaxValidatorAgent
from agents.vendor_matcher import VendorMatcherAgent
from agents.rule_engine import RuleEngineAgent
from agents.concur_publisher import ConcurPublisherAgent
from services.database import get_db
from core.logger import get_logger

log = get_logger(__name__)

PIPELINE = [
    IngestionAgent(),
    HeaderExtractorAgent(),
    LineItemAgent(),
    TaxValidatorAgent(),
    VendorMatcherAgent(),
    RuleEngineAgent(),
    ConcurPublisherAgent(),
]


async def run_pipeline(invoice_id: str, file_bytes: bytes, file_name: str, source: str = "manual") -> dict:
    """
    Runs the full agent pipeline for an invoice.
    Updates the MongoDB document at each stage for live status tracking.
    Returns the final enriched invoice dict.
    """
    db = get_db()
    collection = db["invoices"]

    context: dict = {
        "invoice_id": invoice_id,
        "file_bytes": file_bytes,
        "file_name": file_name,
        "source": source,
        "traces": [],
    }

    await collection.update_one(
        {"id": invoice_id},
        {"$set": {"status": InvoiceStatus.processing}},
    )

    for agent in PIPELINE:
        log.info("Running agent", agent=agent.name, invoice_id=invoice_id)
        try:
            context = await agent.run(context)
        except Exception as e:
            log.error("Agent crashed", agent=agent.name, error=str(e), invoice_id=invoice_id)
            context.setdefault("traces", [])

        # Persist intermediate state so the UI can show live progress
        await _persist_progress(collection, invoice_id, context)

    # Determine final status
    violations = context.get("rule_violations", [])
    has_errors = any(v.get("severity") == "error" for v in violations)
    final_status = InvoiceStatus.pending_review if has_errors else (
        InvoiceStatus.posted if context.get("concur_ref") else InvoiceStatus.approved
    )

    # Average confidence across all agent traces
    traces = context.get("traces", [])
    avg_confidence = sum(t.confidence for t in traces) / len(traces) if traces else 0.0

    update = {
        "status": final_status,
        "confidence": round(avg_confidence, 2),
        "processed_at": datetime.utcnow(),
        "agent_traces": [t.model_dump() for t in traces],
        "vendor": context.get("vendor"),
        "vendor_address": context.get("vendor_address"),
        "invoice_number": context.get("invoice_number"),
        "invoice_date": context.get("invoice_date"),
        "due_date": context.get("due_date"),
        "po_number": context.get("po_number"),
        "currency": context.get("currency", "USD"),
        "subtotal": context.get("subtotal"),
        "tax": context.get("tax"),
        "tax_rate": context.get("tax_rate"),
        "total": context.get("total"),
        "line_items": context.get("line_items", []),
        "rule_violations": context.get("rule_violations", []),
        "concur_ref": context.get("concur_ref"),
    }

    await collection.update_one({"id": invoice_id}, {"$set": update})
    log.info("Pipeline complete", invoice_id=invoice_id, status=final_status, confidence=avg_confidence)

    return update


async def _persist_progress(collection, invoice_id: str, context: dict) -> None:
    try:
        traces = context.get("traces", [])
        await collection.update_one(
            {"id": invoice_id},
            {"$set": {"agent_traces": [t.model_dump() for t in traces]}},
        )
    except Exception:
        pass
