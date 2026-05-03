# InvoiceAI

An agentic invoice processing system built with LangGraph, FastAPI, and Next.js. Invoices are uploaded, processed through a multi-agent pipeline (OCR → header extraction → line items → tax validation → vendor matching → rule engine), and routed to a human review queue before posting to SAP Concur.

## Architecture

```
frontend (Next.js :3000)
    ↕ REST + SSE
backend (FastAPI :8000)
    ↕
mongodb (:27017)          ← LangGraph checkpointer + invoice store
```

**Agent pipeline (LangGraph graph):**
```
ingestion → header_extractor ─┐
          └─ line_item ────────┤→ tax_validator → vendor_matcher → rule_engine → human_review
```

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Docker + Docker Compose | Docker 24+ |
| Python | 3.11+ (local dev only) |
| Node.js | 18+ (local dev only) |
| yarn | 1.22+ (local dev only) |

---

## Quickstart — Docker (recommended)

### 1. Copy environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in the required keys (see [Environment Variables](#environment-variables)).

### 2. Start everything

```bash
docker compose up --build
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| API docs (Swagger) | http://localhost:8000/docs |
| MongoDB | localhost:27017 |

### 3. Rebuild a single service

```bash
# After editing backend code:
docker compose up --build backend -d

# After editing frontend code:
docker compose up --build frontend -d
```

### 4. Stop

```bash
docker compose down          # keep volumes
docker compose down -v       # also wipe MongoDB data
```

---

## Local Development (without Docker)

### MongoDB

Start a local MongoDB instance (Docker is the easiest way):

```bash
docker run -d --name mongo \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=password123 \
  -p 27017:27017 \
  mongo:7.0
```

### Backend

```bash
cd backend

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export MONGODB_URI="mongodb://admin:password123@localhost:27017/invoiceai?authSource=admin"
export MONGODB_DB="invoiceai"
export GROQ_API_KEY="<your-groq-key>"
export ANTHROPIC_API_KEY="<your-anthropic-key>"   # optional — Claude chatbot
export DEBUG="true"
export LOG_LEVEL="INFO"
export CORS_ORIGINS='["http://localhost:3000"]'

# Start the dev server (hot-reload enabled)
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

API available at http://localhost:8000 — interactive docs at http://localhost:8000/docs.

### Frontend

```bash
cd frontend

# Install dependencies
yarn install

# Set environment variables
export NEXT_PUBLIC_API_URL="http://localhost:8000"


# Start the dev server
yarn dev
```

Frontend available at http://localhost:3000.

---

## Environment Variables

Create a `.env` file in the project root (next to `docker-compose.yml`).  
Docker Compose picks this up automatically.

```env
# ── Required ─────────────────────────────────────────────────────────────────
GROQ_API_KEY=            # Groq API key — used for LLM invoice extraction



# ── Optional: Azure ───────────────────────────────────────────────────────────
AZURE_STORAGE_CONNECTION_STRING=       # Blob storage for uploaded invoice files
AZURE_SERVICE_BUS_CONNECTION_STRING=   # Service Bus for async email ingestion
APPLICATIONINSIGHTS_CONNECTION_STRING= # Azure Monitor / OpenTelemetry

# ── Optional: SAP Concur ──────────────────────────────────────────────────────
CONCUR_CLIENT_ID=
CONCUR_CLIENT_SECRET=

# ── Optional: Google ──────────────────────────────────────────────────────────
GOOGLE_API_KEY=          # Alternative LLM provider
```

Leave any optional variable blank — the app falls back to local stubs automatically.

---

## Key API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Health check |
| `POST` | `/api/v1/invoices` | Upload invoice (PDF / JPEG / PNG / TIFF) |
| `GET` | `/api/v1/invoices` | List invoices |
| `GET` | `/api/v1/invoices/{id}` | Get single invoice |
| `GET` | `/api/v1/invoices/{id}/stream` | SSE stream — runs the agent graph |
| `POST` | `/api/v1/invoices/{id}/resume` | Submit human review decision |
| `POST` | `/api/v1/invoices/{id}/post-to-concur` | Post approved invoice to SAP Concur |
| `DELETE` | `/api/v1/invoices/{id}` | Delete invoice |
| `GET` | `/api/v1/analytics/summary` | Dashboard KPIs |

---

## Human Review Flow

Every invoice pauses at the `human_review` node and waits for explicit approval:

1. Upload via the UI → status becomes **processing**
2. Agent pipeline runs → status becomes **pending review**
3. Click **Review Now** in the UI → approve or reject
4. Approved invoices can then be posted to SAP Concur

---

## Project Structure

```
.
├── docker-compose.yml
├── backend/
│   ├── main.py               # FastAPI app + LangGraph setup
│   ├── agents/
│   │   ├── graph.py          # LangGraph graph definition
│   │   ├── state.py          # Shared TypedDict state
│   │   ├── ingestion_agent.py
│   │   ├── header_extractor.py
│   │   ├── line_item_agent.py
│   │   ├── tax_validator.py
│   │   ├── vendor_matcher.py
│   │   ├── rule_engine.py
│   │   └── concur_publisher.py
│   ├── api/routes/
│   │   ├── invoices.py       # Upload, SSE stream, resume, CRUD
│   │   ├── analytics.py
│   │   └── health.py
│   ├── models/               # Pydantic models
│   ├── services/             # MongoDB + Azure storage clients
│   ├── core/                 # Config, logger, telemetry
│   └── requirements.txt
└── frontend/
    ├── app/
    │   └── page.js           # Main dashboard (single-page app)
    ├── lib/
    └── package.json
```
