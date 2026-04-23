import re
import time
from azure.storage.blob import BlobServiceClient
from azure.identity import DefaultAzureCredential
from core.config import get_settings
from core.logger import get_logger

log = get_logger(__name__)
_client: BlobServiceClient | None = None


def get_blob_client() -> BlobServiceClient:
    global _client
    if _client:
        return _client

    settings = get_settings()
    if settings.azure_storage_connection_string:
        _client = BlobServiceClient.from_connection_string(settings.azure_storage_connection_string)
    elif settings.azure_storage_account_url:
        _client = BlobServiceClient(settings.azure_storage_account_url, DefaultAzureCredential())
    else:
        raise RuntimeError(
            "Azure Storage not configured. "
            "Set AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_URL."
        )
    return _client


async def upload_invoice(file_name: str, data: bytes, content_type: str = "application/pdf") -> dict:
    """Upload invoice file to Blob Storage and return blob metadata."""
    settings = get_settings()
    client = get_blob_client()
    container = client.get_container_client(settings.azure_storage_container)

    try:
        container.get_container_properties()
    except Exception:
        container.create_container()

    safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", file_name)
    blob_name = f"{int(time.time() * 1000)}-{safe_name}"
    blob_client = container.get_blob_client(blob_name)

    blob_client.upload_blob(
        data,
        overwrite=True,
        content_settings={"content_type": content_type},
        metadata={"original_name": file_name},
    )

    log.info("Invoice blob uploaded", blob_name=blob_name, size_bytes=len(data))
    return {"blob_name": blob_name, "blob_url": blob_client.url}
