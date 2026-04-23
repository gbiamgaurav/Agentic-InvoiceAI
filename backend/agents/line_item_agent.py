"""
Line Item Agent — extracts individual invoice line items using Claude.
"""
import json
import anthropic
from agents.base import BaseAgent
from models.invoice import LineItem
from core.config import get_settings
from core.logger import get_logger

log = get_logger(__name__)

SYSTEM_PROMPT = """You are a line-item extraction specialist for invoices.
Extract all line items from the invoice text and return ONLY a valid JSON object:
{
  "line_items": [
    {
      "desc": string,
      "qty": number,
      "unit": number,
      "amount": number,
      "conf": number (0.0-1.0)
    }
  ],
  "confidence": number (0.0-1.0)
}
If no line items are found, return an empty list. Never add extra keys."""


class LineItemAgent(BaseAgent):
    name = "line_item"

    def __init__(self):
        self._client = anthropic.Anthropic(api_key=get_settings().anthropic_api_key)

    async def process(self, context: dict) -> dict:
        raw_text: str = context.get("raw_text", "")
        if not raw_text.strip():
            return {"status": "error", "confidence": 0.0, "log": "No text to extract from", "data": {}}

        try:
            response = self._client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": f"Invoice text:\n\n{raw_text[:6000]}"}],
            )

            result = json.loads(response.content[0].text)
            confidence = float(result.get("confidence", 0.8))
            raw_items = result.get("line_items", [])

            line_items = []
            for item in raw_items:
                try:
                    line_items.append(LineItem(**item).model_dump())
                except Exception:
                    pass

            log.info("Line items extracted", count=len(line_items))

            return {
                "status": "ok",
                "confidence": confidence,
                "log": f"{len(line_items)} line item(s) extracted",
                "data": {"line_items": line_items},
            }
        except Exception as e:
            log.error("Line item extraction failed", error=str(e))
            return {"status": "error", "confidence": 0.0, "log": str(e), "data": {"line_items": []}}
