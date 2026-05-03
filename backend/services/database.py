from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from core.config import get_settings
from core.logger import get_logger

log = get_logger(__name__)
_client: AsyncIOMotorClient | None = None


async def connect_db() -> None:
    global _client
    settings = get_settings()
    _client = AsyncIOMotorClient(settings.mongodb_uri)
    # Verify connection
    await _client.admin.command("ping")
    log.info("MongoDB connected", db=settings.mongodb_db)


async def close_db() -> None:
    global _client
    if _client:
        _client.close()
        log.info("MongoDB connection closed")


def get_db() -> AsyncIOMotorDatabase:
    if not _client:
        raise RuntimeError("Database not initialised — call connect_db() first")
    return _client[get_settings().mongodb_db]


def get_motor_client() -> AsyncIOMotorClient:
    """Returns the raw Motor client, used by the LangGraph MongoDB checkpointer."""
    if not _client:
        raise RuntimeError("Database not initialised — call connect_db() first")
    return _client
