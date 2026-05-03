from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # App
    app_name: str = "InvoiceAI Backend"
    app_version: str = "0.1.0"
    debug: bool = False
    log_level: str = "INFO"
    cors_origins: list[str] = ["http://localhost:3000"]

    # MongoDB / Cosmos DB
    mongodb_uri: str = "mongodb://admin:password123@mongodb:27017/invoiceai?authSource=admin"
    mongodb_db: str = "invoiceai"

    # Azure Blob Storage
    azure_storage_connection_string: str = ""
    azure_storage_account_url: str = ""
    azure_storage_container: str = "invoices"

    # Azure Service Bus
    azure_service_bus_connection_string: str = ""
    azure_service_bus_namespace: str = ""
    azure_service_bus_queue: str = "invoice-processing"

    # Azure Application Insights
    applicationinsights_connection_string: str = ""

    # LLM providers
    groq_api_key: str = ""
    google_api_key: str = ""

    # SAP Concur
    concur_client_id: str = ""
    concur_client_secret: str = ""
    concur_base_url: str = "https://us.api.concursolutions.com"

    # Email webhook
    email_webhook_secret: str = ""

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
