# Cawrys: Customer-Owned AI Operations Platform

Understand, decide, process, execute, learn. Cawrys runs in the customer's own environment (their keys, infrastructure, data, permissions). Two independent but connected services share one database, tenant model and audit trail.

| Piece | Tech | Path |
|---|---|---|
| Service 1: Intelligence & Data Processing | Python / FastAPI | `services/intelligence` |
| Service 2: Integration & Action Execution (+ OpenHands Agent Harness) | Python / FastAPI | `services/execution` |
| Edge ingest (files and events) | Go | `services/edge-ingest` |
| AI gateway | LiteLLM proxy (`gemini-4-argon` + `gemini-3.8-flash`) | `infra/litellm` |
| Database | Neon Postgres or offline SQLite WAL fallback | `db/schema.sql`, `db/schema_sqlite.sql` |
| Storage / edge | Cloudflare R2, Worker, Tunnel | `infra/cloudflare` |
| Web app | Next.js 15, React 19, Tailwind, SVG Telemetry | `apps/web` |

## Run it (prototype mode, no keys needed)

```bash
./scripts/init-env.sh    # creates .env with freshly generated AUTH_SECRET and EDGE_API_KEY
docker compose up --build
```

Sign in at http://localhost:3000 with one of the demo accounts (password `cawrys-demo`, set by `DEMO_PASSWORD`):

| Account | Can do |
|---|---|
| `admin@cawrys.local` | everything, including managing users |
| `engineer@cawrys.local` | upload documents, run playbooks, register tools and playbooks |
| `approver@cawrys.local` | approve or reject waiting runs, read everything |
| `viewer@cawrys.local` | read only |

- Web: http://localhost:3000
- Intelligence API docs: http://localhost:8001/docs
- Execution API docs: http://localhost:8002/docs
- Edge ingest: http://localhost:8080 (`POST /ingest/file`, `POST /ingest/event`)

With `MOCK_AI=1`, extraction reads `Key: Value` lines from text/PDF/DOCX files and the reasoning step is a deterministic stand-in. Try a file like:

```
Drawing ID: DWG-1042
Material: Aluminum 6061
Quantity: 25
Tolerance: 0.05
```

Then in the web app: sign in as the engineer, upload it, open the document and run the `production-setup` playbook (seeded automatically). Sign out, sign in as the approver, and approve it on the Approvals page. A file missing `Quantity` is held for review instead.

`scripts/smoke_test.sh` checks a running stack end to end (login, roles, approval flow, audit). Set `OTHER_TENANT_TOKEN` to a token from a second tenant and it also checks tenant isolation.

## Switching to real services

1. **Real AI:** set `MOCK_AI=0`, add provider keys to `.env`, and edit the model names in `infra/litellm/config.yaml`. Images go to the vision model; text, PDF and DOCX go to the extraction model; the reasoning model runs only when fields were extracted.
2. **Neon:** set `NEON_DATABASE_URL` in `.env`, then run `psql "$NEON_DATABASE_URL" -f db/schema.sql`.
3. **Cloudflare R2:** set `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Deploy `infra/cloudflare` with `wrangler deploy` to put auth and routing in front of the APIs.

## Auth and tenants

- Users sign in with email and password (scrypt hashes). Login returns a 12-hour JWT (HS256, signed with `AUTH_SECRET`) carrying user, tenant and role.
- Both services validate the token themselves and scope every query to the token's tenant. The role and tenant never come from request parameters or headers.
- The browser never sees the token: the web app keeps it in an httpOnly cookie and its `/api/*` routes attach it when forwarding to the services. Mutating proxy calls also refuse a cross-site `Origin`.
- Admins create users with `POST /v1/auth/users`. Set `ALLOW_SIGNUP=1` to let anyone create a new tenant (the creator becomes its admin).
- Each new tenant gets the demo tools and `production-setup` playbook on first use (`SEED_DEMO=0` turns that off).
- Machines post events to the Go edge service with an `X-API-Key` (`EDGE_API_KEY`). Files go through it with the user's bearer token, which it forwards.
- The audit log records the person's email for logins, uploads, runs, approvals and rejections.

## How it behaves

- Three tiers: a specialist extraction model, deterministic validation in plain code, and a reasoning model only when there is something to decide.
- Every playbook step passes the policy engine. Low-risk steps run; medium and high-risk steps wait for an approver or admin. An approval resumes the run and never repeats steps that already ran.
- Direct equipment actuation is blocked in policy (`plc`, `machine_direct` connectors). Machine operations must go through an interlocked MES or safety gateway.
- Tools declare JSON Schema inputs; step parameters are validated before anything executes.
- Every document, policy decision, execution and approval is written to the audit log.

## Platform Capabilities

### 1. Operational Dashboard & SVG Telemetry
- **Live Telemetry (`apps/web/app/page.tsx`)**: Aggregates real-time metrics across both `intelligence` (`GET /v1/dashboard/summary`, `GET /v1/system/status`) and `execution` (`GET /v1/dashboard/summary`, `GET /health/ready`).
- **Zero-Dependency Accessible SVG Charts (`apps/web/components/charts.tsx`)**: Renders daily document throughput (`StackedBars`), playbook execution trends, status distributions (`Distribution`), AI token consumption & latency by model role, top playbooks, pending approvals, and live service health probes.
- **System Diagnostics (`POST /v1/system/ai-test`)**: Admins can test AI gateway connectivity and inspect runtime configuration directly from `/settings`.

### 2. White-Label Branding
- Configurable entirely via environment variables (`BRAND_NAME`, `BRAND_COMPANY`, `BRAND_TAGLINE`, `BRAND_SUPPORT_EMAIL`, `BRAND_DOCS_URL`, `BRAND_LOGO_URL`, `BRAND_PRIMARY_COLOR`, `BRAND_ACCENT_COLOR`, `BRAND_HIDE_POWERED_BY`) parsed and validated in `apps/web/lib/brand.ts`.
- Dynamically themes CSS custom properties (`--brand-primary`, `--brand-accent`), sidebar navigation, settings summary, and the SVG favicon route (`/icon.svg`).

### 3. Sliding-Window Login Rate Limiting & User Administration
- **Sliding-Window Throttling (`services/intelligence/app/auth_routes.py`)**: Tracks login attempts in `login_attempts` and enforces a 15-minute sliding window (max 5 failed attempts per email or 30 per client IP), returning `HTTP 429 Too Many Requests` with `Retry-After: 900`.
- **User & Role Administration (`apps/web/app/team/page.tsx`)**: Admins can list users (`GET /v1/auth/users`), invite/create users (`POST /v1/auth/users`), change roles or deactivate accounts (`PATCH /v1/auth/users/{id}`) with safeguards preventing self-demotion or deactivating the last active admin, and rotate passwords (`POST /v1/auth/me/password`).
- **Multi-Method Web Proxy (`apps/web/app/api/[service]/[...path]/route.ts`)**: Forwards `GET`, `POST`, `PATCH`, `PUT`, and `DELETE` requests with `X-Forwarded-For` client IP preservation, path-traversal protection, and cross-origin CSRF verification.

### 4. OpenHands-Inspired Agent Execution Harness
- **Event-Sourced Architecture (`services/execution/app/harness/`)**: Persistent `agent_sessions` and monotonic per-session `agent_events` (`Action` and `Observation` payloads) stored in Postgres/SQLite and streamed in real time via Server-Sent Events (`GET /v1/agent/sessions/{id}/stream`).
- **Multi-Model Orchestrator & Workers (`infra/litellm/config.yaml`)**:
  - **Orchestrator (`cawrys-reason` -> `gemini/gemini-4-argon`)**: Performs high-level task decomposition, step planning (`plan`), tool selection (`tool_call`), sub-task delegation (`delegate`), and completion synthesis (`finish`).
  - **Workers (`cawrys-extract` / `cawrys-vision` -> `gemini/gemini-3.8-flash`)**: Execute delegated sub-tasks (`extract_fields`, `validate_spec`, `summarize`) with low latency, plus full deterministic offline support when `MOCK_AI=1`.
- **Policy Interlocks & Human-in-the-Loop Approvals (`policy_guard.py`)**: Every agent tool call is validated against its JSON Schema and evaluated by `policy.decide()`. Direct equipment actuation (`plc`, `machine_direct`) is hard-blocked (`rejected`), while medium/high-risk tools pause the session in `awaiting_approval` until an `approver` or `admin` calls `POST /v1/agent/sessions/{id}/approve` or `/reject`.

## Verification Commands

Run the unified verification harness (static checks, unit/integration tests, 4-tier E2E suite, SQLite multi-process stress tests, and live stack smoke tests):

```bash
# Full verification suite
./scripts/verify_all.sh all

# Individual verification stages
cd apps/web && npm run typecheck && npm run build
cd services/edge-ingest && go vet ./...
.venv/bin/python3 -m py_compile services/intelligence/app/*.py services/execution/app/*.py services/execution/app/harness/*.py
PYTHONPATH=. .venv/bin/pytest tests/test_agent_harness.py -q
```

## Known prototype limits

- **Token revocation & MFA:** Sliding-window login rate limiting (`login_attempts`) and account deactivation (`is_active`) are built in, but there is no password reset flow, MFA, or pre-expiry JWT revocation list yet. Put Cloudflare Access in front or swap in your identity provider if needed.
- **HTTPS is on you.** Set `COOKIE_SECURE=1` once the web app is served over HTTPS (Cloudflare Tunnel or a reverse proxy). Without it the session cookie can travel over plain HTTP.
- **Demo accounts exist by default.** Set `SEED_DEMO=0` and create real users before exposing the stack.
- **Connectors are stubs.** `log` records intent only; `http` is a generic REST call without secret resolution (`secret_ref` is not yet wired to Vault or a cloud secrets manager). Open Connector or Composio plug in behind `ConnectorProviderAdapter` in `services/execution/app/connectors.py`.
- **Edge events are accepted and logged only.** Wiring them to a queue, MQTT or OPC-UA is the next edge step.

## Build stages

1. Document intelligence & operational telemetry dashboard (done)
2. Action execution, policy engine & OpenHands agent harness with SSE streaming (done)
3. Enterprise: real secret-backed connectors, multi-step branching, schedules, tenant policies
4. Edge: MQTT / OPC-UA, sensors, vision streams (Go service is the starting point)
