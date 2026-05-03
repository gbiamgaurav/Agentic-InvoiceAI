import time
from fastapi import APIRouter
from services.database import get_db
from core.config import get_settings

router = APIRouter()
_start_time = time.time()


@router.get("/health")
async def health_check():
    settings = get_settings()
    checks = {}

    try:
        db = get_db()
        await db.command("ping")
        checks["database"] = {"status": "ok"}
    except Exception as e:
        checks["database"] = {"status": "error", "message": str(e)}

    checks["service_bus"] = (
        {"status": "configured"} if settings.azure_service_bus_connection_string or settings.azure_service_bus_namespace
        else {"status": "unconfigured"}
    )
    checks["blob_storage"] = (
        {"status": "configured"} if settings.azure_storage_connection_string or settings.azure_storage_account_url
        else {"status": "unconfigured"}
    )
    checks["groq"] = (
        {"status": "configured"} if settings.groq_api_key else {"status": "unconfigured"}
    )

    healthy = checks["database"]["status"] == "ok"

    return {
        "status": "healthy" if healthy else "degraded",
        "uptime_seconds": int(time.time() - _start_time),
        "version": settings.app_version,
        "checks": checks,
    }
