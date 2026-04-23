"""
Tax Validator Agent — deterministic check: verifies that
subtotal + tax ≈ total and that the tax rate is within accepted bounds.
No LLM needed here; pure arithmetic is more reliable.
"""
from agents.base import BaseAgent
from core.logger import get_logger

log = get_logger(__name__)

MAX_ACCEPTABLE_TAX_RATE = 0.30  # 30%
TOLERANCE = 0.02  # $0.02 rounding tolerance


class TaxValidatorAgent(BaseAgent):
    name = "tax_validator"

    async def process(self, context: dict) -> dict:
        subtotal = context.get("subtotal") or 0.0
        tax = context.get("tax") or 0.0
        total = context.get("total") or 0.0
        tax_rate = context.get("tax_rate") or 0.0

        issues = []

        # Check subtotal + tax ≈ total
        calculated_total = round(subtotal + tax, 2)
        if total and abs(calculated_total - total) > TOLERANCE:
            issues.append(
                f"Total mismatch: {subtotal} + {tax} = {calculated_total}, declared total = {total}"
            )

        # Infer tax_rate if missing
        if not tax_rate and subtotal > 0 and tax > 0:
            tax_rate = round(tax / subtotal, 4)

        # Validate tax rate bounds
        if tax_rate and tax_rate > MAX_ACCEPTABLE_TAX_RATE:
            issues.append(f"Tax rate {tax_rate:.1%} exceeds maximum allowed {MAX_ACCEPTABLE_TAX_RATE:.1%}")

        confidence = 1.0 if not issues else 0.5
        status = "ok" if not issues else "warning"
        log_msg = "Tax validated" if not issues else f"Tax issues: {'; '.join(issues)}"

        log.info(log_msg, subtotal=subtotal, tax=tax, total=total, tax_rate=tax_rate)

        return {
            "status": status,
            "confidence": confidence,
            "log": log_msg,
            "data": {
                "tax_rate": tax_rate,
                "tax_validation_issues": issues,
            },
        }
