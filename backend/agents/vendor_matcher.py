"""
Vendor Matcher Agent — fuzzy-matches the extracted vendor name against
an approved vendor master list stored in MongoDB.
Uses simple difflib for now; swap for vector/embedding search in production.
"""
import difflib
from agents.base import BaseAgent
from services.database import get_db
from core.logger import get_logger

log = get_logger(__name__)

FUZZY_THRESHOLD = 0.70  # minimum similarity score to consider a match


class VendorMatcherAgent(BaseAgent):
    name = "vendor_matcher"

    async def process(self, context: dict) -> dict:
        vendor_name: str = context.get("vendor") or ""
        if not vendor_name:
            return {
                "status": "warning",
                "confidence": 0.0,
                "log": "No vendor name extracted — skipping vendor match",
                "data": {"vendor_matched": False, "vendor_id": None},
            }

        try:
            db = get_db()
            vendors = await db["vendors"].find({}, {"name": 1, "_id": 1}).to_list(1000)
            names = [v["name"] for v in vendors]

            if not names:
                return {
                    "status": "warning",
                    "confidence": 0.5,
                    "log": "Vendor master list is empty",
                    "data": {"vendor_matched": False, "vendor_id": None},
                }

            matches = difflib.get_close_matches(vendor_name, names, n=1, cutoff=FUZZY_THRESHOLD)

            if matches:
                matched_vendor = next(v for v in vendors if v["name"] == matches[0])
                score = difflib.SequenceMatcher(None, vendor_name.lower(), matches[0].lower()).ratio()
                log.info("Vendor matched", vendor=vendor_name, matched_to=matches[0], score=round(score, 2))
                return {
                    "status": "ok",
                    "confidence": round(score, 2),
                    "log": f"Matched '{vendor_name}' → '{matches[0]}' (score={score:.2f})",
                    "data": {
                        "vendor_matched": True,
                        "vendor_id": str(matched_vendor["_id"]),
                        "vendor_canonical": matches[0],
                    },
                }
            else:
                log.warning("Vendor not matched", vendor=vendor_name)
                return {
                    "status": "warning",
                    "confidence": 0.3,
                    "log": f"Vendor '{vendor_name}' not found in master list",
                    "data": {"vendor_matched": False, "vendor_id": None},
                }
        except Exception as e:
            log.error("Vendor matching failed", error=str(e))
            return {
                "status": "error",
                "confidence": 0.0,
                "log": str(e),
                "data": {"vendor_matched": False, "vendor_id": None},
            }
