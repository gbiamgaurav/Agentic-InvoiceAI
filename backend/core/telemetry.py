"""
Azure Monitor / Application Insights observability.
Initialised once at startup via lifespan in main.py.
"""
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.resources import Resource, SERVICE_NAME, SERVICE_VERSION
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from core.config import get_settings
from core.logger import get_logger

log = get_logger(__name__)


def init_telemetry(app=None) -> None:
    settings = get_settings()

    resource = Resource.create({
        SERVICE_NAME: "invoice-ai-backend",
        SERVICE_VERSION: settings.app_version,
        "deployment.environment": "production" if not settings.debug else "development",
    })

    provider = TracerProvider(resource=resource)

    if settings.applicationinsights_connection_string:
        try:
            from azure.monitor.opentelemetry.exporter import AzureMonitorTraceExporter
            exporter = AzureMonitorTraceExporter(
                connection_string=settings.applicationinsights_connection_string
            )
            provider.add_span_processor(BatchSpanProcessor(exporter))
            log.info("Azure Monitor telemetry initialised")
        except Exception as e:
            log.warning("Azure Monitor exporter failed to initialise", error=str(e))
    else:
        log.warning("APPLICATIONINSIGHTS_CONNECTION_STRING not set — telemetry disabled")

    trace.set_tracer_provider(provider)

    # Auto-instrument HTTP clients and FastAPI request/response
    HTTPXClientInstrumentor().instrument()
    if app:
        FastAPIInstrumentor.instrument_app(app)


def get_tracer(name: str = "invoice-ai") -> trace.Tracer:
    return trace.get_tracer(name)
