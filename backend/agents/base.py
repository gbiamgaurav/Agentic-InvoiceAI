import time
from abc import ABC, abstractmethod
from models.invoice import AgentTrace


class BaseAgent(ABC):
    name: str = "base"

    async def run(self, context: dict) -> dict:
        start = time.monotonic()
        result = await self.process(context)
        duration_ms = int((time.monotonic() - start) * 1000)

        trace = AgentTrace(
            agent=self.name,
            status=result.get("status", "ok"),
            confidence=result.get("confidence", 0.0),
            log=result.get("log", ""),
            duration_ms=duration_ms,
        )
        context.setdefault("traces", []).append(trace)
        context.update(result.get("data", {}))
        return context

    @abstractmethod
    async def process(self, context: dict) -> dict:
        """
        Receives the shared pipeline context dict, returns:
          { status, confidence, log, data: { ...fields to merge into context } }
        """
