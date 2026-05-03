"""
Invoice routes — upload, list, get, SSE stream, human-review resume.

SSE streaming design
─────────────────────
1. POST /invoices          → store invoice + raw file bytes in DB, return invoice_id
2. GET  /invoices/{id}/stream → SSE: runs (or resumes) the LangGraph for that invoice,
                               streams node_start / node_end / interrupted / completed events
3. POST /invoices/{id}/resume → inject human decision via Command(resume=…),
                               frontend then reconnects to /stream for remaining events

Event schema (JSON on each "data:" line)
─────────────────────────────────────────
  { "type": "graph_start",  "invoice_id": "..." }
  { "type": "node_start",   "node": "header_extractor" }
  { "type": "node_end",     "node": "header_extractor", "trace": {…} }
  { "type": "interrupted",  "invoice_id": "…", "violations": […], "confidence": 0.72 }
  { "type": "completed",    "invoice_id": "…", "status": "posted", "concur_ref": "…" }
  { "type": "error",        "message": "…" }
"""
import base64
import json
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from langgraph.types import Command
from pydantic import BaseModel

from agents.graph import make_initial_state
from agents.concur_publisher import ConcurPublisherAgent
from models.invoice import Invoice, InvoiceSource, InvoiceStatus
from services.database import get_db
from services.storage import upload_invoice
from core.logger import get_logger

router = APIRouter(prefix="/invoices", tags=["invoices"])
log = get_logger(__name__)

ALLOWED_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/tiff"}
MAX_FILE_BYTES = 50 * 1024 * 1024

# Nodes that run in parallel (used to emit node_start ahead of time)
PARALLEL_PAIR = {"header_extractor", "line_item"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _state_to_db_patch(delta: dict) -> dict:
    """Convert a LangGraph state delta into a MongoDB $set patch."""
    skip = {"file_bytes", "raw_text", "agent_traces", "error", "source"}
    patch: dict[str, Any] = {}
    for k, v in delta.items():
        if k in skip or k.startswith("__"):
            continue
        patch[k] = v
    # agent_traces is handled separately (appended, not overwritten)
    return patch


async def _persist_delta(db, invoice_id: str, delta: dict) -> None:
    """Persist a node's state delta + any new traces to MongoDB."""
    patch = _state_to_db_patch(delta)
    new_traces = delta.get("agent_traces", [])
    ops: dict = {}
    if patch:
        ops["$set"] = patch
    if new_traces:
        ops["$push"] = {"agent_traces": {"$each": new_traces}}
    if ops:
        await db["invoices"].update_one({"id": invoice_id}, ops)


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("", status_code=202)
async def upload_invoice_endpoint(
    file: UploadFile = File(...),
    uploaded_by: str = Form(default="anonymous"),
    notes: str = Form(default=""),
):
    """
    Accepts a PDF/image invoice, stores it, and returns an invoice_id.
    The client should immediately open GET /invoices/{id}/stream to start
    the LangGraph pipeline and receive real-time events.
    """
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {file.content_type}")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 50 MB limit")

    invoice_id = str(uuid.uuid4())

    blob_meta: dict = {}
    try:
        blob_meta = await upload_invoice(file.filename, file_bytes, file.content_type)
    except Exception as e:
        log.warning("Blob upload failed, continuing without remote storage", error=str(e))

    invoice = Invoice(
        id=invoice_id,
        source=InvoiceSource.manual,
        file_name=file.filename,
        blob_url=blob_meta.get("blob_url"),
        blob_name=blob_meta.get("blob_name"),
        file_size_bytes=len(file_bytes),
        status=InvoiceStatus.queued,
        notes=notes,
        uploaded_by=uploaded_by,
        received_at=datetime.utcnow(),
    )

    db = get_db()
    doc = invoice.model_dump()
    # Temporarily store the raw bytes (base64) so the SSE endpoint can retrieve them.
    # Cleared automatically once ingestion_node runs (sets file_bytes=b"" in state).
    doc["_file_data"] = base64.b64encode(file_bytes).decode()
    await db["invoices"].insert_one(doc)

    log.info("Invoice created", invoice_id=invoice_id, file_name=file.filename)
    return {"invoice_id": invoice_id, "status": "queued"}


# ── SSE stream ────────────────────────────────────────────────────────────────

@router.get("/{invoice_id}/stream")
async def stream_invoice(invoice_id: str, request: Request):
    """
    Server-Sent Events endpoint.  Runs (or resumes) the LangGraph for this
    invoice and streams per-node events back to the client.

    Connection lifecycle
    ─────────────────────
    • Fresh invoice   → starts graph from initial state
    • Mid-run / crash → resumes from last checkpoint (LangGraph handles this)
    • Interrupted     → immediately sends the 'interrupted' event and closes
    • Completed       → immediately sends the 'completed' event and closes
    """
    graph = request.app.state.invoice_graph
    config = {"configurable": {"thread_id": invoice_id}}

    async def generate():
        db = get_db()
        invoice = await db["invoices"].find_one({"id": invoice_id}, {"_id": 0})
        if not invoice:
            yield _sse({"type": "error", "message": "Invoice not found"})
            return

        # ── Inspect current checkpoint state ──────────────────────────────
        try:
            snapshot = await graph.aget_state(config)
        except Exception:
            snapshot = None

        # Already completed?
        if snapshot and snapshot.values and not snapshot.next:
            vals = snapshot.values
            yield _sse({
                "type": "completed",
                "invoice_id": invoice_id,
                "status": vals.get("status", "approved"),
                "concur_ref": vals.get("concur_ref"),
            })
            return

        # Currently interrupted (awaiting human review)?
        if snapshot and snapshot.next:
            # Extract the interrupt value that was sent to the frontend
            interrupt_payload: dict = {}
            for task in (snapshot.tasks or []):
                for intr in (task.interrupts or []):
                    interrupt_payload = intr.value if isinstance(intr.value, dict) else {}
                    break
                if interrupt_payload:
                    break
            yield _sse({"type": "interrupted", "invoice_id": invoice_id, **interrupt_payload})
            return

        # ── Start fresh run ───────────────────────────────────────────────
        file_data = invoice.get("_file_data")
        if not file_data:
            yield _sse({"type": "error", "message": "File data not available; re-upload the invoice"})
            return

        file_bytes = base64.b64decode(file_data)
        initial_state = make_initial_state(
            invoice_id=invoice_id,
            file_bytes=file_bytes,
            file_name=invoice.get("file_name", ""),
            source=invoice.get("source", "manual"),
        )

        await db["invoices"].update_one(
            {"id": invoice_id},
            {"$set": {"status": InvoiceStatus.processing}},
        )
        yield _sse({"type": "graph_start", "invoice_id": invoice_id})

        # ── Stream node updates ───────────────────────────────────────────
        pending_parallel: set[str] = set()

        async for chunk in graph.astream(initial_state, config, stream_mode="updates"):
            if await request.is_disconnected():
                log.info("SSE client disconnected", invoice_id=invoice_id)
                break

            # Human review interrupt
            if "__interrupt__" in chunk:
                interrupts = chunk["__interrupt__"]
                payload = interrupts[0].value if interrupts else {}
                # Persist confidence now — human_review_node hasn't returned yet
                # so its state delta (including confidence) hasn't been written
                db_patch: dict = {"status": InvoiceStatus.pending_review}
                if "confidence" in payload:
                    db_patch["confidence"] = payload["confidence"]
                await db["invoices"].update_one(
                    {"id": invoice_id},
                    {"$set": db_patch},
                )
                yield _sse({"type": "interrupted", "invoice_id": invoice_id, **payload})
                return

            # One chunk can contain multiple nodes (parallel superstep)
            for node_name, delta in chunk.items():
                if node_name.startswith("__"):
                    continue

                # Emit node_start for parallel siblings that haven't been announced yet
                if node_name in PARALLEL_PAIR:
                    siblings = PARALLEL_PAIR - {node_name}
                    for sib in siblings:
                        if sib not in pending_parallel:
                            yield _sse({"type": "node_start", "node": sib})
                            pending_parallel.add(sib)
                    if node_name not in pending_parallel:
                        yield _sse({"type": "node_start", "node": node_name})
                        pending_parallel.add(node_name)
                else:
                    yield _sse({"type": "node_start", "node": node_name})

                # Persist to MongoDB
                await _persist_delta(db, invoice_id, delta)

                trace = (delta.get("agent_traces") or [{}])[-1]
                yield _sse({"type": "node_end", "node": node_name, "trace": trace})

        # ── Graph finished (no interrupt) — emit completed ────────────────
        final_snapshot = await graph.aget_state(config)
        final_vals = final_snapshot.values if final_snapshot else {}

        # Final full-state persist (status, confidence, concur_ref, etc.)
        final_patch = {
            k: final_vals[k]
            for k in ("status", "confidence", "concur_ref", "processed_at")
            if k in final_vals
        }
        final_patch.setdefault("processed_at", datetime.utcnow().isoformat())
        await db["invoices"].update_one({"id": invoice_id}, {"$set": final_patch})

        # Clear the temporary file bytes now that graph has finished
        await db["invoices"].update_one({"id": invoice_id}, {"$unset": {"_file_data": ""}})

        yield _sse({
            "type": "completed",
            "invoice_id": invoice_id,
            "status": final_vals.get("status", "approved"),
            "concur_ref": final_vals.get("concur_ref"),
            "confidence": final_vals.get("confidence", 0.0),
        })

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── Human-review resume ───────────────────────────────────────────────────────

class ResumeRequest(BaseModel):
    decision: str   # "approved" | "rejected"
    reviewed_by: str = "human"
    notes: str = ""


@router.post("/{invoice_id}/resume")
async def resume_invoice(invoice_id: str, body: ResumeRequest, request: Request):
    """
    Resumes a LangGraph that was suspended at the human_review interrupt.
    After this call the client should reconnect to GET /stream to receive
    the remaining node events (concur_publisher → completed).
    """
    if body.decision not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="decision must be 'approved' or 'rejected'")

    graph = request.app.state.invoice_graph
    config = {"configurable": {"thread_id": invoice_id}}

    snapshot = await graph.aget_state(config)
    if not snapshot or not snapshot.next:
        raise HTTPException(status_code=409, detail="Invoice is not currently awaiting review")

    new_status = (
        InvoiceStatus.approved if body.decision == "approved" else InvoiceStatus.rejected
    )

    # Inject the human decision — include status so the graph snapshot is accurate
    await graph.aupdate_state(
        config,
        {
            "review_decision": body.decision,
            "review_notes": body.notes,
            "status": new_status,
        },
        as_node="human_review",
    )

    db = get_db()
    await db["invoices"].update_one(
        {"id": invoice_id},
        {
            "$set": {
                "status": new_status,
                "reviewed_at": datetime.utcnow(),
                "reviewed_by": body.reviewed_by,
                "notes": body.notes,
            }
        },
    )

    log.info("Invoice review submitted", invoice_id=invoice_id, decision=body.decision)
    return {
        "invoice_id": invoice_id,
        "decision": body.decision,
        "status": new_status,
        "message": "Resume the stream endpoint to continue graph execution",
    }


# ── Standard CRUD ─────────────────────────────────────────────────────────────

@router.get("")
async def list_invoices(status: str | None = None, limit: int = 50, skip: int = 0):
    db = get_db()
    query = {"status": status} if status else {}
    cursor = (
        db["invoices"]
        .find(query, {"_id": 0, "_file_data": 0})
        .sort("received_at", -1)
        .skip(skip)
        .limit(limit)
    )
    invoices = await cursor.to_list(limit)
    total = await db["invoices"].count_documents(query)
    return {"invoices": invoices, "total": total, "limit": limit, "skip": skip}


@router.get("/{invoice_id}")
async def get_invoice(invoice_id: str):
    db = get_db()
    invoice = await db["invoices"].find_one({"id": invoice_id}, {"_id": 0, "_file_data": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


@router.delete("/{invoice_id}", status_code=200)
async def delete_invoice(invoice_id: str):
    db = get_db()
    result = await db["invoices"].delete_one({"id": invoice_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    log.info("Invoice deleted", invoice_id=invoice_id)
    return {"invoice_id": invoice_id, "deleted": True}


@router.post("/{invoice_id}/post-to-concur")
async def post_to_concur(invoice_id: str):
    """
    Explicitly post an approved invoice to SAP Concur.
    Called only after the human reviewer confirms all details are correct.
    """
    db = get_db()
    invoice = await db["invoices"].find_one({"id": invoice_id}, {"_id": 0, "_file_data": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.get("status") != InvoiceStatus.approved:
        raise HTTPException(
            status_code=409,
            detail=f"Invoice must be in 'approved' status to post to Concur (current: {invoice.get('status')})",
        )

    agent = ConcurPublisherAgent()
    result = await agent.process(invoice)
    data = result.get("data", {})
    concur_ref = data.get("concur_ref")

    await db["invoices"].update_one(
        {"id": invoice_id},
        {
            "$set": {
                "status": InvoiceStatus.posted,
                "concur_ref": concur_ref,
                "processed_at": datetime.utcnow().isoformat(),
            }
        },
    )

    log.info("Invoice posted to Concur", invoice_id=invoice_id, concur_ref=concur_ref)
    return {"invoice_id": invoice_id, "status": "posted", "concur_ref": concur_ref}
