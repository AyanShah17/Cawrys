# Cawrys: Customer-Owned Industrial AI Operations Platform

Understand, decide, process, execute, and learn. Cawrys runs inside the customer's own environment with customer-controlled keys, data, infrastructure, and permissions. Two cooperating FastAPI microservices, a Go edge-ingest daemon, and a Next.js 15 web application share a unified tenant-isolated database and tamper-evident audit trail.

| Component | Technology | Path |
|---|---|---|
| Service 1: Intelligence & Data Processing | Python / FastAPI | [services/intelligence](file:///Users/ayanshah/LionTix/services/intelligence) |
| Service 2: Execution, Chat, MCP & Agent Harness | Python / FastAPI | [services/execution](file:///Users/ayanshah/LionTix/services/execution) |
| Edge Ingest (files & machine telemetry events) | Go (`net/http` reverse proxy) | [services/edge-ingest](file:///Users/ayanshah/LionTix/services/edge-ingest) |
| AI Gateway & LiteLLM Routing | LiteLLM + Native Provider REST Dispatch | [services/execution/app/chat_routes.py](file:///Users/ayanshah/LionTix/services/execution/app/chat_routes.py) |
| Database | Neon PostgreSQL or offline SQLite WAL fallback | [db/schema.sql](file:///Users/ayanshah/LionTix/db/schema.sql), [db/schema_sqlite.sql](file:///Users/ayanshah/LionTix/db/schema_sqlite.sql) |
| Edge Infrastructure | Cloudflare R2, Worker, Tunnel | [infra/cloudflare](file:///Users/ayanshah/LionTix/infra/cloudflare) |
| Web Application | Next.js 15, React 19, Tailwind CSS, Light Soft-Glass UI | [apps/web](file:///Users/ayanshah/LionTix/apps/web) |

---

## Quick Start (Local Development)

Start all four services (Go Edge Ingest `:8080`, Intelligence `:8001`, Execution `:8002`, and Next.js Web UI `:3000`):

```bash
./scripts/init-env.sh
bash scripts/start_dev.sh
```

Or via Docker Compose:

```bash
./scripts/init-env.sh
docker compose up --build
```

Sign in at `http://localhost:3000/login` using the seeded demo accounts (default password `cawrys-demo`, controlled by `DEMO_PASSWORD`):

| Account | Role & Access Scope |
|---|---|
| `admin@cawrys.local` | Full platform control: configure LiteLLM providers/keys, connect/disconnect Marketplace & MCP toolkits, run/approve playbooks, upload documents, manage users & white-label branding |
| `engineer@cawrys.local` | On-site engineering view: upload documents, run & register playbooks/tools, chat with stored documents and pre-configured connectors; **read-only lock** on LiteLLM credentials and connector reconfigurations |
| `approver@cawrys.local` | Review, approve, or reject medium/high-risk playbook executions & agent tool calls |
| `viewer@cawrys.local` | Read-only operational visibility |

---

## Core Architecture & Features

### 1. Dual-Mode Light Soft-Glass UI (`AI Mode` & `Dashboard Mode`)
- **Floating Pill Navigation (`apps/web/components/top-nav.tsx`)**: Mode switcher pill toggles seamlessly between:
  - **AI Mode**: Agent Chat (`/chat`), Connectors (`/connectors`), Marketplace (`/marketplace`), and Settings (`/settings`).
  - **Dashboard Mode**: Overview (`/`), Documents (`/documents`), Execution & Playbooks (`/playbooks`), Approvals (`/approvals`), Audit Log (`/audit`), and Team (`/team`).
- **ChatGPT / Grok-Style Conversational Canvas (`apps/web/components/chat-interface.tsx`)**:
  - Collapsible workspace drawer listing live stored CAD drawings, PDFs, and specs from `/api/intelligence/v1/documents` for instant single-click prompt context attachment, alongside active connected toolkits.
  - Real-time dashboard mutations directly from natural-language prompts (`POST /v1/dashboard/override`) and execution telemetry badges (`Live AI` vs `Context Engine`).

### 2. LiteLLM 20-Provider Integration & Dynamic Model Discovery
- **Provider Catalog (`services/execution/app/chat_routes.py`)**: Supports 20 providers (`gemini`, `openai`, `anthropic`, `deepseek`, `groq`, `mistral`, `ollama`, `openrouter`, `perplexity`, `together_ai`, `cohere`, `xai`, `azure`, `bedrock`, `vertex_ai`, `cloudflare`, `fireworks_ai`, `anyscale`, `replicate`, `custom`) with official default base URLs and environment key detection (`GET /v1/chat/providers`).
- **Live Model Fetching (`POST /v1/chat/models/fetch`)**: Queries provider model endpoints live (Ollama `/api/tags`, OpenAI-compatible `/models`, Gemini `/models`) with resilient catalog fallbacks.
- **Dual-Path LLM Invocation**: Attempts LiteLLM execution whenever user credentials, environment keys, or local Ollama are present, with direct provider REST fallback (`Gemini generateContent`, `OpenAI /chat/completions`, `Anthropic /v1/messages`, `Ollama /api/chat`) and deterministic context-grounded fallback offline.

### 3. Composio 1,640+ Toolkit Marketplace & Industrial FastMCP Connectors
- **Composio Marketplace (`services/execution/app/composio_marketplace.py`)**: Search, category checkbox filtering, sorting, configuration modal (`apps/web/components/marketplace-config-modal.tsx`), and direct Composio connection lifecycle (`POST /v1/marketplace/connect`).
- **Industrial FastMCP Connectors (`services/execution/app/industrial_mcp.py`)**: Native API & FastMCP adapters for SAP S/4HANA, Siemens Xcelerator / Teamcenter PLM, Rockwell FactoryTalk, Schneider EcoStruxure, ABB Ability, and Emerson DeltaV (`GET /connectors` & live tool test runner).

### 4. Execution Playbooks, Policy Engine & OpenHands Agent Harness
- **Interactive Playbooks Manager (`apps/web/components/playbooks-manager.tsx`)**: Browse seeded workflows (`production-setup`, `sap-inventory-reconciliation`, `siemens-eco-release`), customize inputs, run playbooks (`POST /v1/executions`), inspect step outputs, and register new playbooks or JSON-Schema-validated tools.
- **Policy Interlocks (`services/execution/app/policy.py`)**: Hard-blocks direct `plc` and `machine_direct` connectors (`rejected`), auto-runs `low` risk steps, and pauses `medium`/`high` risk steps in `awaiting_approval` for human sign-off.
- **Agent Execution Harness (`services/execution/app/harness/`)**: Persistent `agent_sessions` and `agent_events` with real-time SSE streaming.

### 5. Security, Readiness & Non-Functional Hardening
- **Tenant-Isolated JWT Auth & Rate Limiting (`services/intelligence/app/auth_routes.py`)**: 12-hour HS256 JWTs stored in `httpOnly` cookies (`cawrys_token`), 15-minute sliding-window login throttling (`429 Too Many Requests`), cross-origin CSRF enforcement, and URL/path traversal filtering in the Next.js server proxy.
- **Security & Observability Headers**: Both FastAPI services attach `X-Request-ID`, `X-Response-Time-Ms`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: strict-origin-when-cross-origin` on every response.
- **Readiness Probes**: `GET /health` and `GET /health/ready` (verifying database connectivity) on Intelligence `:8001` and Execution `:8002`.

---

## Verification & Testing

Run the complete test suite (unit, integration, and 4-tier E2E security/pipeline tests with automatic in-memory dispatcher fallback inside sandboxes):

```bash
# Run all 178 tests (unit + integration + 4-tier E2E)
PYTHONPATH=. .venv/bin/pytest tests/ -q

# Web typecheck & production build
cd apps/web && npm run typecheck && npm run build

# Go static check
cd services/edge-ingest && go vet ./...

# Live stack end-to-end smoke check (when services are running)
bash scripts/smoke_test.sh
```
