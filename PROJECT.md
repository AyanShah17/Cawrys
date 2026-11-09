# Project: Cawrys Monorepo Setup & Model Routing

## Architecture
Cawrys is a distributed, security-hardened workflow and document intelligence monorepo consisting of:
- `apps/web`: Next.js 15, React 19, TypeScript web interface with server-side proxy (`/api/[service]/...`) and `httpOnly` session cookies.
- `services/intelligence`: Python 3.12 / FastAPI intelligence service for extraction, document OCR/vision, reasoning, and document storage.
- `services/execution`: Python 3.12 / FastAPI execution service managing action proposals, risk policies, approvals, and tool registry.
- `services/edge-ingest`: Go 1.22 streaming ingest proxy with rate limiting and API key authentication.
- `infra/litellm`: LiteLLM Proxy routing abstract model names (`cawrys-reason`, `cawrys-extract`, `cawrys-vision`) to upstream AI providers.
- `scripts`: Automation and verification suite (`init-env.sh`, `smoke_test.sh`).

## Code Layout
- `apps/web/` — Web application frontend and proxy API
- `services/intelligence/` — Document intelligence & reasoning API
- `services/execution/` — Action execution & policy enforcement API
- `services/edge-ingest/` — Ingestion proxy service
- `infra/litellm/` — LiteLLM gateway routing configuration
- `db/` — Database schema definitions
- `scripts/` — Environment setup and end-to-end verification scripts
- `.agents/teamwork/` — Teamwork orchestration metadata only

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Archive Extraction | Extract `media_1794243001841_2b6e8ff4.zip` into `/Users/ayanshah/LionTix` preserving directory layout and `.agents/` | M1 | R1 / Survey |
| 2 | Dependency Installation | Set up dependencies for `apps/web` (npm), Python services (uv/pip), and Go modules | M1 | R1 / Survey |
| 3 | Environment Script Portability | Fix macOS BSD `sed` compatibility in `scripts/init-env.sh` | M1 | Survey |
| 4 | Orchestrator Model Routing | Route orchestrator (`cawrys-reason` / `MODEL_REASON`) to Gemini 4 Argon (`gemini/gemini-4-argon`) in `infra/litellm/config.yaml` | M2 | R2 / Survey |
| 5 | Worker & Sub-Agent Model Routing | Route worker (`cawrys-extract` / `MODEL_EXTRACT`) and sub-agent (`cawrys-vision` / `MODEL_VISION`) to Gemini 3.8 Flash (`gemini/gemini-3.8-flash`) | M2 | R2 / Survey |
| 6 | Environment Model Configurations | Update `.env.example` and generated `.env` with `GEMINI_API_KEY` and Gemini model mappings | M2 | R2 / Survey |
| 7 | Deterministic AI Mock | Verify and support offline execution via `MOCK_AI=1` (`services/intelligence/app/mock.py`) | M3 | R3 / Survey |
| 8 | Database Fallback Support | Provide local fallback (SQLite adapter or local DB) when live Neon DB credentials are not provided | M3 | R3 / Survey |
| 9 | Local Storage Fallback | Verify local disk storage fallback when `R2_ENDPOINT` is omitted | M3 | R3 / Survey |
| 10 | Web App Build & Lint | `apps/web` type-check (`tsc --noEmit`) and production build | M4 | R4 / Survey |
| 11 | Go Edge-Ingest Build & Vet | `services/edge-ingest` build and `go vet` | M4 | R4 / Survey |
| 12 | Python Services Syntax & Check | `services/intelligence` and `services/execution` syntax and import compilation | M4 | R4 / Survey |
| 13 | Full Stack Smoke Test | `scripts/smoke_test.sh` end-to-end integration test execution | M4 | R4 / Survey |
| 14 | Final E2E Test Suite | Comprehensive opaque-box E2E test verification | Final | Dual Track |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Codebase Extraction & Setup | Extract archive, install dependencies, fix script portability | none | DONE |
| M2 | Model Routing & Agent Configuration | Configure Gemini 4 Argon for orchestrator and Gemini 3.8 Flash for worker/sub-agents | M1 | DONE |
| M3 | Environment & Local Mock Support | Configure deterministic AI mock, local DB fallback, local storage fallback | M1, M2 | DONE |
| M4 | Monorepo Build, Lint & Smoke Verification | Compile web app, Go service, Python services; run smoke test | M1, M2, M3 | DONE |
| Final | E2E Test Suite Verification | Pass 100% of requirement-derived E2E tests | M4, TEST_READY | DONE |

## Interface Contracts
### Intelligence ↔ LiteLLM Router
- In live mode, Intelligence calls LiteLLM Proxy (`http://localhost:4000/chat/completions`) using OpenAI-compatible API with models: `cawrys-reason`, `cawrys-extract`, `cawrys-vision`.
- In mock mode (`MOCK_AI=1`), Intelligence executes `mock.py` deterministically without network calls.

### Intelligence / Execution ↔ Database
- In live cloud mode, uses `NEON_DATABASE_URL` / `DATABASE_URL` (PostgreSQL with PgBouncer compatibility).
- In local fallback mode, uses embedded SQLite adapter when external DB credentials are absent.

### Web Proxy ↔ Backend Services
- `/api/intelligence/...` forwards to `http://localhost:8001/...`
- `/api/execution/...` forwards to `http://localhost:8002/...`
- Uses internal service bearer tokens / JWT session authentication.
