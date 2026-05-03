"""
LangGraph invoice processing graph.

Topology
────────
START
  └─► ingestion
        ├─► header_extractor ─┐   (parallel superstep)
        └─► line_item ────────┤
                              ▼
                        tax_validator
                              │
                        vendor_matcher
                              │
                         rule_engine
                              │
                        human_review   ◄── interrupt() if violations / low confidence
                         ╱       ╲
               approved ╱         ╲ rejected
                        ▼           ▼
                concur_publisher   END
                        │
                       END
"""
import time
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt

from agents.state import InvoiceState
from agents.ingestion_agent import IngestionAgent
from agents.header_extractor import HeaderExtractorAgent
from agents.line_item_agent import LineItemAgent
from agents.tax_validator import TaxValidatorAgent
from agents.vendor_matcher import VendorMatcherAgent
from agents.rule_engine import RuleEngineAgent
from models.invoice import AgentTrace, InvoiceStatus
from core.logger import get_logger

log = get_logger(__name__)

# ── Agent singletons (one instance shared across all graph invocations) ───────
_ingestion = IngestionAgent()
_header_extractor = HeaderExtractorAgent()
_line_item = LineItemAgent()
_tax_validator = TaxValidatorAgent()
_vendor_matcher = VendorMatcherAgent()
_rule_engine = RuleEngineAgent()

CONFIDENCE_REVIEW_THRESHOLD = 0.85


async def _run(agent, context: dict) -> tuple[dict, AgentTrace]:
    """Runs one agent and returns (data_dict, trace)."""
    start = time.monotonic()
    result = await agent.process(context)
    duration_ms = int((time.monotonic() - start) * 1000)
    trace = AgentTrace(
        agent=agent.name,
        status=result.get("status", "ok"),
        confidence=result.get("confidence", 0.0),
        log=result.get("log", ""),
        duration_ms=duration_ms,
    )
    return result.get("data", {}), trace


# ── Node functions ────────────────────────────────────────────────────────────

async def ingestion_node(state: InvoiceState) -> dict:
    data, trace = await _run(_ingestion, dict(state))
    return {
        "raw_text": data.get("raw_text", ""),
        "page_count": data.get("page_count", 0),
        "file_bytes": b"",          # clear large binary from checkpointer
        "agent_traces": [trace.model_dump()],
        "status": InvoiceStatus.processing,
    }


async def header_extractor_node(state: InvoiceState) -> dict:
    data, trace = await _run(_header_extractor, dict(state))
    # Only include keys that were actually extracted
    header_fields = [
        "vendor", "vendor_address", "bill_to", "bill_to_address",
        "invoice_number", "invoice_date", "due_date", "po_number",
        "currency", "subtotal", "tax", "tax_rate", "total",
    ]
    update = {k: data[k] for k in header_fields if k in data}
    update["agent_traces"] = [trace.model_dump()]
    return update


async def line_item_node(state: InvoiceState) -> dict:
    data, trace = await _run(_line_item, dict(state))
    return {
        "line_items": data.get("line_items", []),
        "agent_traces": [trace.model_dump()],
    }


async def tax_validator_node(state: InvoiceState) -> dict:
    data, trace = await _run(_tax_validator, dict(state))
    return {
        "tax_rate": data.get("tax_rate", state.get("tax_rate", 0.0)),
        "tax_validation_issues": data.get("tax_validation_issues", []),
        "agent_traces": [trace.model_dump()],
    }


async def vendor_matcher_node(state: InvoiceState) -> dict:
    data, trace = await _run(_vendor_matcher, dict(state))
    return {
        "vendor_matched": data.get("vendor_matched", False),
        "vendor_id": data.get("vendor_id"),
        "vendor_canonical": data.get("vendor_canonical"),
        "agent_traces": [trace.model_dump()],
    }


async def rule_engine_node(state: InvoiceState) -> dict:
    data, trace = await _run(_rule_engine, dict(state))
    return {
        "rule_violations": data.get("rule_violations", []),
        "agent_traces": [trace.model_dump()],
    }


EXTRACTION_AGENTS = {"ingestion", "header_extractor", "line_item"}


async def human_review_node(state: InvoiceState) -> dict:
    """
    Always pauses for human review — every invoice requires explicit approval.
    The frontend resumes by calling POST /invoices/{id}/resume.

    Confidence is the average over extraction-only agents (ingestion, header_extractor,
    line_item).  Tax validator, vendor matcher, and rule engine are deterministic
    pass/fail checks — including them dilutes the ML extraction quality signal.
    """
    violations = state.get("rule_violations", [])
    traces = state.get("agent_traces", [])
    extraction_traces = [t for t in traces if t.get("agent") in EXTRACTION_AGENTS]
    avg_conf = (
        sum(t.get("confidence", 0) for t in extraction_traces) / len(extraction_traces)
        if extraction_traces else 0.0
    )
    avg_conf = round(avg_conf, 3)

    # Always interrupt — human must approve or reject every invoice
    human_input = interrupt({
        "type": "review_required",
        "invoice_id": state["invoice_id"],
        "violations": violations,
        "confidence": avg_conf,
    })
    decision = human_input.get("decision", "rejected")
    return {
        "review_decision": decision,
        "review_notes": human_input.get("notes", ""),
        "status": InvoiceStatus.approved if decision == "approved" else InvoiceStatus.rejected,
        "confidence": avg_conf,
    }



# ── Graph builder ─────────────────────────────────────────────────────────────

def build_invoice_graph(checkpointer):
    """
    Compiles and returns the LangGraph CompiledStateGraph.
    Pass the AsyncMongoDBSaver (or MemorySaver for tests) as checkpointer.
    """
    builder = StateGraph(InvoiceState)

    # Register nodes
    builder.add_node("ingestion", ingestion_node)
    builder.add_node("header_extractor", header_extractor_node)
    builder.add_node("line_item", line_item_node)
    builder.add_node("tax_validator", tax_validator_node)
    builder.add_node("vendor_matcher", vendor_matcher_node)
    builder.add_node("rule_engine", rule_engine_node)
    builder.add_node("human_review", human_review_node)

    # Sequential entry
    builder.add_edge(START, "ingestion")

    # Fan-out: header_extractor and line_item run in the same superstep (parallel)
    builder.add_edge("ingestion", "header_extractor")
    builder.add_edge("ingestion", "line_item")

    # Fan-in: tax_validator only runs once BOTH parallel nodes have finished
    builder.add_edge("header_extractor", "tax_validator")
    builder.add_edge("line_item", "tax_validator")

    # Sequential tail
    builder.add_edge("tax_validator", "vendor_matcher")
    builder.add_edge("vendor_matcher", "rule_engine")
    builder.add_edge("rule_engine", "human_review")

    # Graph ends after human review — posting to Concur is an explicit human action
    builder.add_edge("human_review", END)

    return builder.compile(checkpointer=checkpointer)


# ── Initial state factory ─────────────────────────────────────────────────────

def make_initial_state(
    invoice_id: str,
    file_bytes: bytes,
    file_name: str,
    source: str = "manual",
) -> InvoiceState:
    return InvoiceState(
        invoice_id=invoice_id,
        file_bytes=file_bytes,
        file_name=file_name,
        source=source,
        raw_text="",
        page_count=0,
        vendor=None,
        vendor_address=None,
        bill_to=None,
        bill_to_address=None,
        invoice_number=None,
        invoice_date=None,
        due_date=None,
        po_number=None,
        currency="USD",
        subtotal=0.0,
        tax=0.0,
        tax_rate=0.0,
        total=0.0,
        line_items=[],
        tax_validation_issues=[],
        vendor_matched=False,
        vendor_id=None,
        vendor_canonical=None,
        rule_violations=[],
        agent_traces=[],
        review_decision=None,
        review_notes=None,
        concur_ref=None,
        status=InvoiceStatus.processing,
        confidence=0.0,
        error=None,
    )
