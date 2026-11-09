# Cawrys: Customer-Owned AI Operations Platform

Understand, decide, process, execute, learn. Cawrys runs in the customer's own environment (their keys, infrastructure, data, permissions). Two independent but connected services share one database, tenant model and audit trail.

| Piece | Tech | Path |
|---|---|---|
| Service 1: Intelligence & Data Processing | Python / FastAPI | `services/intelligence` |
| Service 2: Integration & Action Execution | Python / FastAPI | `services/execution` |
| Edge ingest (files and events) | Go | `services/edge-ingest` |
| AI gateway | LiteLLM proxy | `infra/litellm` |
| Database | Neon (or the bundled local Postgres) | `db/schema.sql` |
| Storage / edge | Cloudflare R2, Worker, Tunnel | `infra/cloudflare` |
| Web app | Next.js, Tailwind, Aceternity-style components | `apps/web` |

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

## Known prototype limits

- **Login hardening is minimal.** There is no rate limiting or lockout, no password reset, no MFA, and tokens cannot be revoked before they expire. Put Cloudflare rate limiting or Access in front, or swap in your identity provider (the services only need a valid JWT with `sub`, `tid`, `role`).
- **HTTPS is on you.** Set `COOKIE_SECURE=1` once the web app is served over HTTPS (Cloudflare Tunnel or a reverse proxy). Without it the session cookie can travel over plain HTTP.
- **Demo accounts exist by default.** Set `SEED_DEMO=0` and create real users before exposing the stack.
- **Connectors are stubs.** `log` records intent only; `http` is a generic REST call without secret resolution (`secret_ref` is not yet wired to Vault or a cloud secrets manager). Open Connector or Composio plug in behind `ConnectorProviderAdapter` in `services/execution/app/connectors.py`.
- **Real model calls are untested** (no provider keys were available); the LiteLLM path follows the standard OpenAI-compatible proxy interface.
- **`docker compose` itself was not run** in the environment used to build this; the services, database schema and web build were each run directly and tested together.
- **Edge events are accepted and logged only.** Wiring them to a queue, MQTT or OPC-UA is the next edge step.
- Aceternity-style Spotlight and Bento components are written locally. Vengeance UI is not wired in; add its components into `apps/web/components/ui`.

## Build stages

1. Document intelligence (done)
2. Action execution with approvals (done, stub connectors)
3. Enterprise: real connectors, multi-step branching, schedules, tenant policies
4. Edge: MQTT / OPC-UA, sensors, vision streams (Go service is the starting point)
