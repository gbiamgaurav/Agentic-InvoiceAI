"""
Ingestion Agent — loads the PDF from Blob Storage, runs page segmentation,
and extracts raw text via pdfplumber. In production swap pdfplumber for
Azure Document Intelligence (Form Recognizer) for higher accuracy.
"""
import io
import pdfplumber
from agents.base import BaseAgent
from core.logger import get_logger

log = get_logger(__name__)


class IngestionAgent(BaseAgent):
    name = "ingestion"

    async def process(self, context: dict) -> dict:
        raw_bytes: bytes = context.get("file_bytes", b"")
        file_name: str = context.get("file_name", "")

        if not raw_bytes:
            return {"status": "error", "confidence": 0.0, "log": "No file bytes in context", "data": {}}

        try:
            pages_text = []
            with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
                page_count = len(pdf.pages)
                for page in pdf.pages:
                    text = page.extract_text() or ""
                    pages_text.append(text)

            full_text = "\n".join(pages_text)
            ocr_quality = min(1.0, len(full_text) / max(1, page_count * 200))

            log.info(
                "Ingestion complete",
                file_name=file_name,
                pages=page_count,
                chars=len(full_text),
            )

            return {
                "status": "ok",
                "confidence": round(ocr_quality, 2),
                "log": f"{page_count} page(s) detected · {len(full_text)} chars extracted",
                "data": {
                    "raw_text": full_text,
                    "page_count": page_count,
                },
            }
        except Exception as e:
            log.error("Ingestion failed", error=str(e), file_name=file_name)
            return {
                "status": "error",
                "confidence": 0.0,
                "log": f"Ingestion error: {e}",
                "data": {"raw_text": ""},
            }
