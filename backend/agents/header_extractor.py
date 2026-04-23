"""
Header Extractor Agent — uses Claude to extract vendor, invoice number,
dates, PO number, and currency from the raw invoice text.
"""
import json
import anthropic
from agents.base import BaseAgent
from core.config import get_settings
from core.logger import get_logger

log = get_logger(__name__)

SYSTEM_PROMPT = """You are an invoice data extraction specialist.
Extract the following fields from the invoice text provided.
Return ONLY a valid JSON object with these exact keys:
{
  "vendor": string or null,
  "vendor_address": string or null,
  "invoice_number": string or null,
  "invoice_date": "YYYY-MM-DD" or null,
  "due_date": "YYYY-MM-DD" or null,
  "po_number": string or null,
  "currency": "USD"|"EUR"|"GBP"|"INR"|... (ISO 4217),
  "subtotal": number or null,
  "tax": number or null,
  "tax_rate": number or null (0.0-1.0),
  "total": number or null,
  "confidence": number (0.0-1.0)
}
If a field is not found, use null. Never add extra keys."""


class HeaderExtractorAgent(BaseAgent):
    name = "header_extractor"

    def __init__(self):
        self._client = anthropic.Anthropic(api_key=get_settings().anthropic_api_key)

    async def process(self, context: dict) -> dict:
        raw_text: str = context.get("raw_text", "")
        if not raw_text.strip():
            return {"status": "error", "confidence": 0.0, "log": "No text to extract from", "data": {}}

        # Truncate to avoid excessive token usage — header data is near top
        excerpt = raw_text[:4000]

        try:
            response = self._client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=512,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": f"Invoice text:\n\n{excerpt}"}],
            )

            extracted = json.loads(response.content[0].text)
            confidence = float(extracted.pop("confidence", 0.8))

            log.info(
                "Header extracted",
                vendor=extracted.get("vendor"),
                invoice_number=extracted.get("invoice_number"),
                total=extracted.get("total"),
            )

            return {
                "status": "ok",
                "confidence": confidence,
                "log": f"vendor={extracted.get('vendor')} · invoice#={extracted.get('invoice_number')} · total={extracted.get('total')}",
                "data": extracted,
            }
        except json.JSONDecodeError as e:
            log.error("Header extraction JSON parse failed", error=str(e))
            return {"status": "error", "confidence": 0.0, "log": f"JSON parse error: {e}", "data": {}}
        except Exception as e:
            log.error("Header extraction failed", error=str(e))
            return {"status": "error", "confidence": 0.0, "log": str(e), "data": {}}
