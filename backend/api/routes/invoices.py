import uuid
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from models.invoice import Invoice, InvoiceStatus, InvoiceSource, InvoiceReviewRequest
from services.database import get_db
from services.storage import upload_invoice
from agents.pipeline import run_pipeline
from core.logger import get_logger

router = APIRouter(prefix="/invoices", tags=["invoices"])
log = get_logger(__name__)

ALLOWED_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/tiff"}
MAX_FILE_BYTES = 50 * 1024 * 1024


@router.post("", status_code=202)
async def upload_invoice_endpoint(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    uploaded_by: str = Form(default="anonymous"),
    notes: str = Form(default=""),
):
    """Manual invoice upload — stores to Blob Storage, creates DB record, runs pipeline async."""
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {file.content_type}")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 50 MB limit")

    invoice_id = str(uuid.uuid4())
    blob_meta = {}
    try:
        blob_meta = await upload_invoice(file.filename, file_bytes, file.content_type)
    except Exception as e:
        log.warning("Blob upload failed, proceeding without storage", error=str(e))

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
    await db["invoices"].insert_one(invoice.model_dump())
    log.info("Invoice created", invoice_id=invoice_id, file_name=file.filename, source="manual")

    # Run pipeline in background so the API returns immediately
    background_tasks.add_task(run_pipeline, invoice_id, file_bytes, file.filename, "manual")

    return {"invoice_id": invoice_id, "status": "queued", "message": "Processing started"}


@router.get("")
async def list_invoices(status: str | None = None, limit: int = 50, skip: int = 0):
    db = get_db()
    query = {"status": status} if status else {}
    cursor = db["invoices"].find(query, {"_id": 0}).sort("received_at", -1).skip(skip).limit(limit)
    invoices = await cursor.to_list(limit)
    total = await db["invoices"].count_documents(query)
    return {"invoices": invoices, "total": total, "limit": limit, "skip": skip}


@router.get("/{invoice_id}")
async def get_invoice(invoice_id: str):
    db = get_db()
    invoice = await db["invoices"].find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


@router.post("/{invoice_id}/review")
async def review_invoice(invoice_id: str, body: InvoiceReviewRequest):
    if body.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")

    new_status = InvoiceStatus.approved if body.action == "approve" else InvoiceStatus.rejected
    db = get_db()
    result = await db["invoices"].update_one(
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
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")

    log.info("Invoice reviewed", invoice_id=invoice_id, action=body.action)
    return {"invoice_id": invoice_id, "status": new_status}
