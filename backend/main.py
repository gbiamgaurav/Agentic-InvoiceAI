from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langgraph.checkpoint.mongodb.aio import AsyncMongoDBSaver

from core.config import get_settings
from core.logger import configure_logging, get_logger
from core.telemetry import init_telemetry
from services.database import connect_db, close_db, get_motor_client
from agents.graph import build_invoice_graph
from api.routes import health, invoices, email_ingest, analytics

configure_logging()
log = get_logger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting InvoiceAI backend", version=settings.app_version)
    await connect_db()

    # Build LangGraph with a MongoDB-backed checkpointer so state is persisted
    # across SSE reconnections and survives restarts.
    motor_client = get_motor_client()
    checkpointer = AsyncMongoDBSaver(motor_client, db_name=settings.mongodb_db)
    await checkpointer._setup()
    app.state.checkpointer = checkpointer
    app.state.invoice_graph = build_invoice_graph(checkpointer)
    log.info("LangGraph invoice graph compiled and ready")

    yield

    await close_db()
    log.info("InvoiceAI backend shut down")


app = FastAPI(
    title="InvoiceAI Backend",
    version=settings.app_version,
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Must be called at module level — instrument_app adds middleware, which
# Starlette rejects if called after the app has started (inside lifespan).
init_telemetry(app)

app.include_router(health.router, prefix="/api/v1", tags=["health"])
app.include_router(invoices.router, prefix="/api/v1")
app.include_router(email_ingest.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")


@app.get("/")
async def root():
    return {"service": "invoice-ai-backend", "version": settings.app_version, "docs": "/docs"}
