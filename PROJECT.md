# Project: Cawrys OpenHands Harness & Feature Restoration

## Architecture
- **Monorepo Structure**:
  - `apps/web`: Next.js 15 (React 19) frontend, dynamic proxy routes (`/api/[service]/[...path]`), session auth cookies.
  - `services/intelligence`: FastAPI service (port 8001), document processing, auth, users, operational dashboard, LiteLLM gateway.
  - `services/execution`: FastAPI service (port 8002), playbook executions, policy engine, connector tool registry, and new OpenHands agent execution harness.
  - `services/edge-ingest`: Go service (port 8080), fast ingestion gateway.
  - `infra/litellm`: Multi-model routing config mapping `cawrys-reason` -> `gemini-4-argon` and `cawrys-extract`/`cawrys-vision` -> `gemini-3.8-flash`.
  - `tests/e2e`: Centralized pytest test harness with 4 tiers of tests and dual-mode live/mock runner.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | White-Labeling | Configurable branding via env vars (`BRAND_NAME`, `BRAND_COMPANY`, `BRAND_TAGLINE`, `BRAND_PRIMARY_COLOR`, etc.), `lib/brand.ts`, dynamic logo, sidebar, icon, settings page | M1 | /tmp/cawrys_snapshot.json |
| 2 | Login Throttling & Security | DB table `login_attempts`, sliding window rate limiting (5 fails/email, 30 fails/IP per 15 min, HTTP 429 + `Retry-After`), user `is_active` check | M1 | /tmp/cawrys_snapshot.json |
| 3 | User Management | `GET/POST/PATCH /v1/auth/users`, `POST /v1/auth/me/password`, `app/team/page.tsx`, `components/team-manager.tsx`, admin bootstrapping | M1 | /tmp/cawrys_snapshot.json |
| 4 | Operational Dashboard | `services/intelligence/app/dashboard.py` endpoints, SVG chart components, UI kit, operational dashboard page at `app/page.tsx` | M1 | /tmp/cawrys_snapshot.json |
| 5 | Web Proxy Method Expansion | Expand `apps/web/app/api/[service]/[...path]/route.ts` to export `GET, POST, PATCH, PUT, DELETE` and forward client IP | M1 | /tmp/cawrys_snapshot.json |
| 6 | OpenHands Event Stream | Monotonic append-only event stream (`agent_events` table), typed `Action` and `Observation` schemas | M2 | OpenHands Architecture |
| 7 | Action-Observation Loop | Execution loop in `services/execution/app/harness/`, step progression, execution trace, max steps guard | M2 | OpenHands Architecture |
| 8 | Policy Gating & Sandboxing | Interlocking with `policy.decide`: block forbidden connectors (`plc`, `machine_direct`), gate medium/high risk on approval, pause on `awaiting_approval` | M2 | Cawrys Execution Policy |
| 9 | Multi-Model Routing & Mocks | Gemini 4 Argon (`cawrys-reason`) for orchestrator planning, Gemini 3.8 Flash (`cawrys-extract`/`vision`) for worker execution, deterministic `MOCK_AI=1` fallbacks | M2 | ORIGINAL_REQUEST §R1 |
| 10 | Agent REST & SSE Streaming API | `GET /v1/agent/sessions/{id}/stream` (SSE), session CRUD, `/approve` and `/reject` endpoints, proxy passthrough via `/api/execution/v1/agent/...` | M2 | ORIGINAL_REQUEST §R1 |
| 11 | E2E Test Suite Extension | 15 test cases in `test_09_agent_harness.py`, 6 test cases in `test_10_snapshot_features.py`, offline mock server updates in `mock_server.py` | M3 | Verification Survey |
| 12 | Combined Branch Integration | Merge `ui` and `openhands` branches into `combined`, verify cross-service flows, SQLite WAL concurrency, zero regression | M4 | ORIGINAL_REQUEST §R3 |
| 13 | Main Branch Merge & Smoke Test | Merge `combined` into `main`, execute `scripts/verify_all.sh all` and `scripts/smoke_test.sh`, achieving 100% pass | M5 | ORIGINAL_REQUEST §R3 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | UI & Snapshot Feature Restoration (`ui` branch) | Restore white-labeling, login throttling, user management, dashboard in `apps/web` and `services/intelligence`, update proxy route | none | DONE |
| M2 | OpenHands Agent Harness (`openhands` branch) | Implement agent execution harness in `services/execution/app/harness/`, event stream, action-observation loop, Gemini 4 Argon/3.8 Flash routing, policy gating | none | PLANNED |
| M3 | E2E Test Suite & Infrastructure Extension | Extend `tests/e2e/` with `test_09_agent_harness.py`, `test_10_snapshot_features.py`, and `mock_server.py` updates | M1, M2 | PLANNED |
| M4 | Combined Branch Integration (`combined` branch) | Merge `ui` and `openhands` branches into `combined`, execute full test suite, resolve any integration discrepancies | M1, M2, M3 | PLANNED |
| M5 | Final Merge to `main` & Verification | Merge `combined` into `main`, run `scripts/verify_all.sh all` (static checks, 105+ E2E tests, 25 SQLite stress tests, 22 smoke checks) | M4 | PLANNED |

## Interface Contracts
### `apps/web` ↔ `services/intelligence`
- Auth: `POST /v1/auth/login` returns `{access_token, token_type, user: {id, email, role, tenant_id}}`.
- Rate Limiting: 429 Too Many Requests with header `Retry-After: 900` when failed login exceeds 5/email or 30/IP in 15 min.
- Users: `GET /v1/auth/users` (admin only), `POST /v1/auth/users` (admin only), `PATCH /v1/auth/users/{user_id}` (admin only), `POST /v1/auth/me/password` (authenticated).
- Dashboard: `GET /v1/dashboard/summary`, `GET /v1/system/status`, `POST /v1/system/ai-test`.
- Web Proxy: Exports `GET, POST, PATCH, PUT, DELETE` on `/api/[service]/[...path]`.

### `apps/web` / Client ↔ `services/execution` (OpenHands Harness)
- Create Session: `POST /v1/agent/sessions` with `{task: str, context: dict, max_steps: int}` -> `{session_id: str, status: "running" | "awaiting_approval" | "completed" | "failed"}`.
- Get State: `GET /v1/agent/sessions/{session_id}` -> session state, current step, results.
- Event Stream (SSE): `GET /v1/agent/sessions/{session_id}/stream` -> `text/event-stream` emitting `data: {"seq": int, "type": "action" | "observation", "name": str, "payload": dict}`.
- Approval Workflow: `POST /v1/agent/sessions/{session_id}/approve` -> resumes paused session; `POST /v1/agent/sessions/{session_id}/reject` -> terminates session as rejected.
- Policy Enforcement: Blocks `plc` and `machine_direct`; requires approver/admin for high risk; requires approval for medium/high risk tools.

## Code Layout
- `apps/web/`:
  - `lib/brand.ts`: White-labeling configuration loader.
  - `components/logo.tsx`, `components/sidebar.tsx`, `components/charts.tsx`, `components/ui/kit.tsx`, `components/team-manager.tsx`.
  - `app/page.tsx`, `app/settings/page.tsx`, `app/team/page.tsx`, `app/documents/page.tsx`, `app/licenses/page.tsx`, `app/icon.svg/route.ts`.
  - `app/api/[service]/[...path]/route.ts`: Web proxy route.
- `services/intelligence/`:
  - `app/auth_routes.py`: Throttling, user management endpoints.
  - `app/dashboard.py`: Dashboard summary & system status endpoints.
  - `app/sqlite_adapter.py`: SQLite schema for `login_attempts` and user columns.
- `services/execution/`:
  - `app/harness/`: OpenHands agent execution harness subpackage.
    - `models.py`: Event, Action, Observation, Session schemas.
    - `stream.py`: Event stream manager and SSE streaming.
    - `orchestrator.py`: Gemini 4 Argon (`cawrys-reason`) planning & delegation.
    - `worker.py`: Gemini 3.8 Flash (`cawrys-extract`/`vision`) worker execution.
    - `loop.py`: Action-observation loop and state machine.
    - `policy_guard.py`: Integration with `app/policy.py`.
    - `mock.py`: Deterministic offline execution for `MOCK_AI=1`.
    - `routes.py`: REST and SSE router mounted on FastAPI.
- `tests/e2e/`:
  - `tier1_feature/test_09_agent_harness.py`: 15 OpenHands harness tests.
  - `tier1_feature/test_10_snapshot_features.py`: 6 snapshot feature tests.
  - `mock_server.py`: Extended mock endpoints for offline test execution.
