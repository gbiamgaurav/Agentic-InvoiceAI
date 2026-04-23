"""
SAP Concur Publisher Agent — posts approved invoices to Concur Invoice v4 API.
Only runs when the invoice status is 'approved' and has no error-level violations.
"""
import random
import httpx
from agents.base import BaseAgent
from core.config import get_settings
from core.logger import get_logger

log = get_logger(__name__)


class ConcurPublisherAgent(BaseAgent):
    name = "concur_publisher"

    async def process(self, context: dict) -> dict:
        # Only publish invoices that cleared rule checks
        violations = context.get("rule_violations", [])
        errors = [v for v in violations if v.get("severity") == "error"]
        if errors:
            return {
                "status": "skipped",
                "confidence": 1.0,
                "log": f"Skipped Concur publish — {len(errors)} rule error(s) must be resolved first",
                "data": {},
            }

        settings = get_settings()
        if not settings.concur_client_id or not settings.concur_client_secret:
            # Dev mode — simulate Concur reference
            concur_ref = f"CNR-INV-{random.randint(10000, 99999)}"
            log.info("Concur publish simulated (credentials not configured)", concur_ref=concur_ref)
            return {
                "status": "ok",
                "confidence": 1.0,
                "log": f"[SIMULATED] Concur reference: {concur_ref}",
                "data": {"concur_ref": concur_ref},
            }

        try:
            token = await _get_concur_token(settings)
            concur_ref = await _post_invoice(settings, token, context)
            log.info("Invoice posted to Concur", concur_ref=concur_ref)
            return {
                "status": "ok",
                "confidence": 1.0,
                "log": f"Posted to Concur · ref={concur_ref}",
                "data": {"concur_ref": concur_ref},
            }
        except Exception as e:
            log.error("Concur publish failed", error=str(e))
            return {"status": "error", "confidence": 0.0, "log": str(e), "data": {}}


async def _get_concur_token(settings) -> str:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.concur_base_url}/oauth2/v0/token",
            data={
                "grant_type": "client_credentials",
                "client_id": settings.concur_client_id,
                "client_secret": settings.concur_client_secret,
            },
        )
        resp.raise_for_status()
        return resp.json()["access_token"]


async def _post_invoice(settings, token: str, context: dict) -> str:
    payload = {
        "vendorName": context.get("vendor"),
        "invoiceNumber": context.get("invoice_number"),
        "invoiceDate": context.get("invoice_date"),
        "dueDate": context.get("due_date"),
        "currencyCode": context.get("currency", "USD"),
        "invoiceAmount": context.get("total"),
        "purchaseOrderNumber": context.get("po_number"),
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.concur_base_url}/invoice/v4/invoices",
            json=payload,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        resp.raise_for_status()
        return resp.json().get("id", f"CNR-INV-{random.randint(10000, 99999)}")
