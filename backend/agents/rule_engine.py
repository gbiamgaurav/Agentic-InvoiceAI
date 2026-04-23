"""
Rule Engine Agent — applies configurable business rules loaded from MongoDB.
Each rule has a type, severity (error|warning), and threshold.
Deterministic — no LLM.
"""
from agents.base import BaseAgent
from models.invoice import RuleViolation
from services.database import get_db
from core.logger import get_logger

log = get_logger(__name__)


class RuleEngineAgent(BaseAgent):
    name = "rule_engine"

    async def process(self, context: dict) -> dict:
        violations = []

        try:
            db = get_db()
            rules = await db["rules"].find({"enabled": True}).to_list(100)
        except Exception:
            # Fall back to hardcoded defaults if DB is unavailable
            rules = _default_rules()

        for rule in rules:
            violation = _evaluate_rule(rule, context)
            if violation:
                violations.append(violation)

        errors = [v for v in violations if v["severity"] == "error"]
        warnings = [v for v in violations if v["severity"] == "warning"]

        status = "error" if errors else ("warning" if warnings else "ok")
        confidence = 1.0 if not violations else 0.5

        log.info(
            "Rules evaluated",
            total_rules=len(rules),
            violations=len(violations),
            errors=len(errors),
        )

        return {
            "status": status,
            "confidence": confidence,
            "log": f"{len(rules)} rules · {len(errors)} error(s) · {len(warnings)} warning(s)",
            "data": {"rule_violations": violations},
        }


def _evaluate_rule(rule: dict, context: dict) -> dict | None:
    rule_type = rule.get("type", "")
    severity = rule.get("severity", "warning")
    rule_id = str(rule.get("_id", rule.get("id", rule_type)))

    if rule_type == "require_po" and not context.get("po_number"):
        return RuleViolation(
            rule_id=rule_id, severity=severity, message="PO number is required but missing"
        ).model_dump()

    if rule_type == "max_amount":
        threshold = float(rule.get("threshold", 10000))
        total = float(context.get("total") or 0)
        if total > threshold:
            return RuleViolation(
                rule_id=rule_id,
                severity=severity,
                message=f"Invoice total ${total:,.2f} exceeds limit ${threshold:,.2f}",
            ).model_dump()

    if rule_type == "allowed_currency":
        allowed = rule.get("values", ["USD"])
        currency = context.get("currency", "USD")
        if currency not in allowed:
            return RuleViolation(
                rule_id=rule_id,
                severity=severity,
                message=f"Currency '{currency}' not in allowed list: {allowed}",
            ).model_dump()

    if rule_type == "vendor_must_match" and not context.get("vendor_matched"):
        return RuleViolation(
            rule_id=rule_id,
            severity=severity,
            message="Vendor not found in approved vendor master list",
        ).model_dump()

    return None


def _default_rules() -> list[dict]:
    return [
        {"id": "default-po", "type": "require_po", "severity": "error", "enabled": True},
        {"id": "default-amount", "type": "max_amount", "severity": "warning", "threshold": 50000, "enabled": True},
        {"id": "default-currency", "type": "allowed_currency", "severity": "error", "values": ["USD", "EUR", "GBP"], "enabled": True},
        {"id": "default-vendor", "type": "vendor_must_match", "severity": "warning", "enabled": True},
    ]
