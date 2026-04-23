"""
Email Ingest Route — webhook called by Azure Logic Apps / Azure Communication Services
when an invoice arrives by email.

Azure Logic App sends a POST with this body shape:
{
  "email_from": "vendor@example.com",
  "subject": "Invoice #1234",
  "received_at": "2024-01-15T10:30:00Z",
  "attachments": [
    { "name": "invoice.pdf", "content_type": "application/pdf", "content_base64": "..." }
  ]
}
"""
import uuid
import hmac
import hashlib
from datetime import datetime
from fastapi import APIRouter, Request, HTTPException
from models.invoice import Invoice, InvoiceStatus, InvoiceSource, EmailIngestRequest
from services.database import get_db
from services.storage import upload_invoice
from services.queue import enqueue_invoice
from core.config import get_settings
from core.logger import get_logger

router = APIRouter(prefix="/email-ingest", tags=["email"])
log = get_logger(__name__)

ALLOWED_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/tiff"}


def _verify_signature(raw_body: bytes, signature_header: str | None) -> bool:
    secret = get_settings().email_webhook_secret
    if not secret:
        return True  # Disabled in dev
    if not signature_header:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    received = signature_header.replace("sha256=", "")
    return hmac.compare_digest(expected, received)


@router.post("")
async def ingest_from_email(request: Request):
    raw_body = await request.body()
    sig = request.headers.get("x-webhook-signature")

    if not _verify_signature(raw_body, sig):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload = EmailIngestRequest.model_validate_json(raw_body)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Invalid payload: {e}")

    pdf_attachments = [
        a for a in payload.attachments
        if a.get("content_type", "").lower() in ALLOWED_TYPES
    ]

    log.info(
        "Email ingest received",
        email_from=payload.email_from,
        subject=payload.subject,
        total_attachments=len(payload.attachments),
        pdf_count=len(pdf_attachments),
    )

    if not pdf_attachments:
        return {"message": "No supported invoice attachments found", "queued": 0}

    db = get_db()
    queued = []

    for attachment in pdf_attachments:
        try:
            file_bytes = __import__("base64").b64decode(attachment["content_base64"])
            invoice_id = str(uuid.uuid4())

            blob_meta = {}
            try:
                blob_meta = await upload_invoice(
                    attachment["name"], file_bytes, attachment["content_type"]
                )
            except Exception as e:
                log.warning("Blob upload failed for email attachment", error=str(e))

            invoice = Invoice(
                id=invoice_id,
                source=InvoiceSource.email,
                file_name=attachment["name"],
                blob_url=blob_meta.get("blob_url"),
                blob_name=blob_meta.get("blob_name"),
                file_size_bytes=len(file_bytes),
                status=InvoiceStatus.queued,
                email_from=payload.email_from,
                email_subject=payload.subject,
                received_at=datetime.utcnow(),
            )
            await db["invoices"].insert_one(invoice.model_dump())

            # Also push to Service Bus for durable async processing
            try:
                await enqueue_invoice({
                    "invoice_id": invoice_id,
                    "source": "email",
                    "file_name": attachment["name"],
                    "blob_url": blob_meta.get("blob_url", ""),
                    "blob_name": blob_meta.get("blob_name", ""),
                    "email_from": payload.email_from,
                })
            except Exception as e:
                log.warning("Service Bus enqueue failed", error=str(e))

            log.info("Invoice queued from email", invoice_id=invoice_id, file_name=attachment["name"])
            queued.append({"invoice_id": invoice_id, "file_name": attachment["name"]})

        except Exception as e:
            log.error("Failed to process email attachment", error=str(e), file_name=attachment.get("name"))

    return {"message": f"Queued {len(queued)} invoice(s)", "queued": queued}
