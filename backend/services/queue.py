import json
from azure.servicebus import ServiceBusClient, ServiceBusMessage
from azure.identity import DefaultAzureCredential
from core.config import get_settings
from core.logger import get_logger

log = get_logger(__name__)
_client: ServiceBusClient | None = None


def get_servicebus_client() -> ServiceBusClient:
    global _client
    if _client:
        return _client

    settings = get_settings()
    if settings.azure_service_bus_connection_string:
        _client = ServiceBusClient.from_connection_string(settings.azure_service_bus_connection_string)
    elif settings.azure_service_bus_namespace:
        _client = ServiceBusClient(settings.azure_service_bus_namespace, DefaultAzureCredential())
    else:
        raise RuntimeError(
            "Azure Service Bus not configured. "
            "Set AZURE_SERVICE_BUS_CONNECTION_STRING or AZURE_SERVICE_BUS_NAMESPACE."
        )
    return _client


async def enqueue_invoice(payload: dict) -> None:
    """Push an invoice processing job onto Service Bus."""
    settings = get_settings()
    client = get_servicebus_client()

    with client.get_queue_sender(settings.azure_service_bus_queue) as sender:
        msg = ServiceBusMessage(
            body=json.dumps(payload),
            content_type="application/json",
            subject="invoice.received",
            application_properties={
                "source": payload.get("source", "manual"),
                "file_name": payload.get("file_name", ""),
            },
        )
        sender.send_messages(msg)

    log.info(
        "Invoice enqueued",
        queue=settings.azure_service_bus_queue,
        source=payload.get("source"),
        file_name=payload.get("file_name"),
    )
