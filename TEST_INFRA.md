# Cawrys E2E Test Infrastructure Specification

**Document Version:** 1.0.0  
**Author:** `test_writer_e2e`  
**Target:** Cawrys Monorepo (`/Users/ayanshah/LionTix`)  
**Methodology:** 4-Tier Opaque-Box End-to-End Verification  
**Integrity Mode:** Development & CI/CD Verification  

---

## 1. Executive Summary

This document establishes the architecture, test runners, and comprehensive test suite for the **Cawrys** monorepo. Cawrys is a security-hardened, customer-owned AI operations platform comprising:
- `services/intelligence`: Python 3.12 / FastAPI (Document ingestion, multimodal extraction, deterministic rules validation, operational reasoning, audit trail, authentication).
- `services/execution`: Python 3.12 / FastAPI (Playbook execution engine, JSON Schema validation, deterministic risk policies, human-in-the-loop approvals, credential-isolated connectors).
- `services/edge-ingest`: Go 1.22 (High-throughput streaming ingestion proxy with semaphore concurrency control and sensor event buffering).
- `apps/web`: Next.js 15 / React 19 / TypeScript (Operational UI, server-side reverse proxy `/api/[service]/...` with `httpOnly` session cookies and CSRF Origin protection).
- `infra/litellm`: LiteLLM gateway routing model aliases to upstream providers (Gemini 4 Argon for reasoning orchestrator, Gemini 3.8 Flash for extraction and vision workers).

The test suite exercises the system as a true **opaque-box** (black box over HTTP) with zero internal knowledge assumptions, strictly verifying interface contracts, status codes, payload structures, role-based access control, deterministic risk policies, idempotency, and audit logging.

---

## 2. 4-Tier Testing Methodology

The E2E test suite adheres to the 4-tier testing hierarchy:

```
┌────────────────────────────────────────────────────────────────────────┐
│               Tier 4: Real-World Application Scenarios                 │
│  - Emergency Part Shortage & Incomplete Technical Drawing Workflow     │
│  - Malicious Equipment Direct Actuation / PLC Interlock Defense        │
│  - Web Proxy Perimeter Defense & Cross-Origin CSRF Attack Neutralization│
├────────────────────────────────────────────────────────────────────────┤
│               Tier 3: Cross-Feature Combinations                       │
│  - Full Lifecycle: Ingest -> Extract -> Validate -> Reason ->          │
│    Execution -> Policy Gate -> Approval -> Succeeded -> Audit Log      │
│  - Cross-Tenant Strict Boundary & Data Isolation Verification          │
├────────────────────────────────────────────────────────────────────────┤
│               Tier 2: Boundary & Corner Cases                          │
│  - Empty Files & Oversized Multipart Payloads (>50MB, >1MB events)     │
│  - Token Forgery, Tampered Signatures, Expired Tokens, Unknown Roles   │
│  - Path Traversal (../, %2e%2e), Host Header Spoofing, Origin Mismatches│
│  - Double-Approval / Replay Prevention (HTTP 409 Conflict)             │
│  - Rapid Sequential & Concurrent Ingestion Stress                      │
├────────────────────────────────────────────────────────────────────────┤
│               Tier 1: Comprehensive Feature Coverage (>=5 per feature) │
│  1. Authentication & RBAC (8 tests)                                    │
│  2. High-Throughput Edge Ingestion (6 tests)                          │
│  3. Multimodal & Deterministic Extraction (6 tests)                    │
│  4. Operational Reasoning Engine (5 tests)                             │
│  5. Policy Enforcement & Risk Gating (6 tests)                         │
│  6. Human-in-the-Loop Approval Workflow (7 tests)                     │
│  7. Actor-Attributed Audit Trail (6 tests)                             │
│  8. Web Application Server Proxy (6 tests)                             │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Tier 1: Feature Coverage (>= 5 Tests Per Feature)
1. **Authentication & RBAC**:
   - `test_01_login_valid_credentials`: Verifies JWT issuance, claims (`sub`, `tid`, `role`, `email`), expiration, and user object for all 4 roles (`admin`, `engineer`, `approver`, `viewer`).
   - `test_02_login_invalid_password`: Verifies HTTP 401 Unauthorized with timing attack resistance.
   - `test_03_login_nonexistent_user`: Verifies HTTP 401 Unauthorized for unregistered emails.
   - `test_04_signup_disabled_by_default`: Verifies HTTP 403 Forbidden when `ALLOW_SIGNUP=0`.
   - `test_05_authenticated_me_endpoint`: Verifies `/v1/auth/me` returns current user session identity.
   - `test_06_admin_create_valid_user`: Verifies admin can provision new accounts with valid roles.
   - `test_07_create_user_short_password_rejected`: Verifies HTTP 422 Unprocessable Entity when password length < 8 chars.
   - `test_08_create_user_invalid_role_rejected`: Verifies HTTP 400 Bad Request when role is not in `admin`, `engineer`, `approver`, `viewer`.

2. **Ingestion Service (`services/edge-ingest` & `services/intelligence`)**:
   - `test_01_direct_document_upload_engineer`: Verifies direct multipart upload by `engineer` returns HTTP 200 with `document_id` and `extraction_id`.
   - `test_02_edge_proxy_file_forwarding`: Verifies Go edge proxy streams multipart file to intelligence, preserves bearer auth, and returns extraction payload.
   - `test_03_edge_proxy_missing_auth_rejected`: Verifies Go edge proxy rejects unauthenticated uploads with HTTP 401.
   - `test_04_edge_sensor_event_valid_key`: Verifies telemetry JSON accepted with HTTP 202 and `X-API-Key`.
   - `test_05_edge_sensor_event_invalid_key`: Verifies telemetry rejected with HTTP 401 when `X-API-Key` is invalid or missing.
   - `test_06_edge_sensor_event_malformed_json`: Verifies HTTP 400 Bad Request on invalid JSON body.

3. **Document Extraction (`services/intelligence`)**:
   - `test_01_complete_drawing_extraction`: Verifies complete drawing text extracts `drawing_id`, `material`, `quantity` with >=0.95 confidence.
   - `test_02_general_document_extraction`: Verifies non-drawing text produces `doc_type: document` with extracted key-value pairs.
   - `test_03_numeric_field_coercion`: Verifies integers (`25`) and floating point numbers (`0.05`) are correctly coerced into numeric types.
   - `test_04_missing_required_drawing_fields`: Verifies incomplete drawing identifies missing fields (e.g., missing `quantity` or `material`).
   - `test_05_negative_dimensions_flagged`: Verifies physical dimensions with negative numbers (`Quantity: -10`) trigger validation issues.
   - `test_06_image_mock_extraction`: Verifies mock vision extraction produces `doc_type: image` and flags `vision_model_required`.

4. **Operational Reasoning (`services/intelligence`)**:
   - `test_01_valid_drawing_proposes_playbook`: Verifies valid technical drawing automatically generates `run_playbook:production-setup` action.
   - `test_02_validation_issues_generate_open_questions`: Verifies extraction issues produce actionable open questions (`Resolve: missing_fields`).
   - `test_03_reasoning_summary_synthesis`: Verifies reasoning summary accurately describes document type and field counts.
   - `test_04_clean_document_status_ready`: Verifies documents with zero validation issues and low/medium risk actions receive `status: ready`.
   - `test_05_flagged_document_status_needs_review`: Verifies documents with missing fields, low confidence, or high risk receive `status: needs_review`.

5. **Execution Policies (`services/execution`)**:
   - `test_01_low_risk_tool_auto_executes`: Verifies tools with `risk: low` execute immediately to `succeeded` without manual intervention.
   - `test_02_medium_risk_tool_pauses_for_approval`: Verifies tools with `risk: medium` halt at execution step and transition to `status: awaiting_approval`.
   - `test_03_high_risk_tool_requires_approval`: Verifies tools with `risk: high` pause and require approver/admin clearance.
   - `test_04_forbidden_connectors_denied`: Verifies tools targeting direct machine actuation (`plc`, `machine_direct`) are blocked by policy (`status: rejected`).
   - `test_05_viewer_execution_denied`: Verifies `viewer` role attempting playbook execution is immediately rejected by policy.
   - `test_06_missing_playbook_not_found`: Verifies executing a non-existent playbook returns HTTP 404.

6. **Approvals Workflow (`services/execution`)**:
   - `test_01_approver_can_approve`: Verifies `approver` role successfully approves pending execution and resumes remaining steps to `succeeded`.
   - `test_02_admin_can_approve`: Verifies `admin` role has authority to approve pending executions.
   - `test_03_engineer_cannot_approve`: Verifies `engineer` role attempting approval receives HTTP 403 Forbidden.
   - `test_04_viewer_cannot_approve`: Verifies `viewer` role attempting approval receives HTTP 403 Forbidden.
   - `test_05_approver_can_reject`: Verifies `approver` can reject pending execution, setting `status: rejected`.
   - `test_06_double_approval_conflict`: Verifies approving an already approved or completed execution returns HTTP 409 Conflict.
   - `test_07_step_execution_idempotency`: Verifies step 0 (already executed) is not re-executed when resuming execution from step 1.

7. **Audit Logs (`services/intelligence` & `services/execution`)**:
   - `test_01_upload_audit_events`: Verifies `document.received` and `document.processed` events are logged with correct document ID.
   - `test_02_execution_lifecycle_audit`: Verifies `execution.awaiting_approval` and `execution.approved.succeeded` events are recorded.
   - `test_03_policy_decision_audit`: Verifies policy decisions (`policy.allow`, `policy.needs_approval`, `policy.deny`) are logged with step index and reason.
   - `test_04_actor_attribution_integrity`: Verifies audit records log real user email (e.g., `approver@cawrys.local`), not generic tokens.
   - `test_05_failed_login_audit`: Verifies invalid authentication attempts emit `auth.login_failed` with target email.
   - `test_06_audit_chronological_ordering`: Verifies `/v1/audit` returns logs in descending chronological order (`created_at desc`).

8. **Web Application Server Proxy (`apps/web`)**:
   - `test_01_proxy_authenticated_request`: Verifies Next.js proxy reads `cawrys_token` httpOnly cookie and injects `Authorization: Bearer <token>` to upstream services.
   - `test_02_proxy_unauthenticated_request`: Verifies proxy returns HTTP 401 Unauthorized when session cookie is absent.
   - `test_03_proxy_csrf_origin_guard`: Verifies proxy returns HTTP 403 Forbidden when mutating request (`POST`) has mismatched `Origin` header.
   - `test_04_proxy_path_traversal_blocked`: Verifies directory traversal attempts (`/api/intelligence/v1/../../etc/passwd` or `%2e%2e`) return HTTP 400 Bad Request.
   - `test_05_proxy_login_route_forbidden`: Verifies calling `/api/intelligence/v1/auth/login` through proxy returns HTTP 404 (enforcing `/api/login`).
   - `test_06_proxy_unknown_service_404`: Verifies calling `/api/unknown_service/v1/resource` returns HTTP 404 Not Found.

---

### 2.2 Tier 2: Boundary & Corner Cases
- **Empty & Oversized Payloads**:
  - `test_empty_file_upload_rejected`: Verifies `POST /v1/documents` with a 0-byte file returns HTTP 400 Bad Request (`detail: empty file`).
  - `test_edge_ingest_oversized_payload`: Verifies payload exceeding 50MB is halted by Go `MaxBytesReader`.
  - `test_edge_event_oversized_payload`: Verifies sensor event payload exceeding 1MB is rejected.
- **Security & Token Boundaries**:
  - `test_garbage_token_rejected`: Verifies `Bearer abc.def.ghi` returns HTTP 401.
  - `test_expired_token_rejected`: Verifies JWT with expired timestamp `exp: now - 3600` returns HTTP 401.
  - `test_tampered_signature_token`: Verifies JWT signed with an alternate secret returns HTTP 401.
  - `test_invalid_role_token`: Verifies JWT with `role: superuser` (not in allowed list) returns HTTP 401.
  - `test_unauthenticated_access_all_endpoints`: Verifies all protected endpoints reject requests lacking `Authorization` headers.
- **Perimeter & Input Validation Boundaries**:
  - `test_schema_validation_missing_required_params`: Verifies executing a tool with missing required input schema keys returns HTTP 422 Unprocessable Entity.
  - `test_schema_validation_invalid_types`: Verifies executing a tool with incorrect parameter types (e.g. string where number required) returns HTTP 422.
  - `test_tool_registration_invalid_json_schema`: Verifies registering a tool with malformed JSON Schema returns HTTP 400/422.
  - `test_double_reject_conflict`: Verifies rejecting an already rejected or completed execution returns HTTP 409 Conflict.
  - `test_approve_non_awaiting_execution`: Verifies approving an execution in status `succeeded` or `rejected` returns HTTP 409 Conflict.

---

### 2.3 Tier 3: Cross-Feature Combinations
- **Complete End-to-End Operational Lifecycle**:
  - Workflow:
    1. Admin authenticates and provisions engineer `engineer.qa@cawrys.local`.
    2. Engineer logs in, receives authenticated JWT session.
    3. Engineer uploads a precision technical drawing (`DWG-8800`, Aluminum 7075, Quantity 50, Tolerance 0.02) through Edge Ingest.
    4. Intelligence service extracts fields, deterministic validation passes with 1.0 confidence, reasoning orchestrator recommends `run_playbook:production-setup`. Document status reaches `ready`.
    5. Engineer initiates execution of `production-setup` referencing the extraction ID.
    6. Execution engine validates schema, auto-executes Step 0 (`erp_lookup_inventory`, low risk), halts at Step 1 (`schedule_production`, medium risk), transitions to `awaiting_approval`.
    7. Engineer attempts approval -> Blocked with HTTP 403 Forbidden.
    8. Approver logs in and clears Step 1 -> Execution resumes, Step 1 and Step 2 (`notify_team`) succeed, final status is `succeeded`.
    9. Approver attempts double approval -> Blocked with HTTP 409 Conflict.
    10. Admin inspects audit log -> Confirms complete chain: `document.received`, `document.processed`, `execution.awaiting_approval`, `policy.allow`, `policy.needs_approval`, `execution.approved.succeeded`, `tool.executed` with exact actor email attribution.
- **Multi-Tenant Complete Isolation**:
  - Tenant A and Tenant B both operate within the platform.
  - Tenant B bearer token cannot access Tenant A documents (`HTTP 404 Not Found`).
  - Tenant B cannot view Tenant A executions (`empty list` or `404`).
  - Tenant B cannot approve or reject Tenant A executions.
  - Tenant B audit queries return zero logs generated by Tenant A.

---

### 2.4 Tier 4: Real-World Application Scenarios
1. **Scenario 1: Emergency Part Shortage & Incomplete Spec Handling**:
   - Machine shop receives an emergency order drawing with missing material specifications or tolerances.
   - Uploaded through Edge Ingest -> Flagged with `status: needs_review`, `missing: ['material']`.
   - Reasoning model generates targeted operational questions: `Resolve: missing_fields`.
   - System enforces that playbooks cannot run without human review.
2. **Scenario 2: Safety Interlock Violation Defense**:
   - An unvalidated or adversarial playbook requests direct actuation of a physical PLC (`connector: plc` or `connector: machine_direct`).
   - Execution policy engine evaluates step connector against `FORBIDDEN_CONNECTORS`.
   - Direct execution is immediately blocked (`status: rejected`, `reason: direct equipment actuation is blocked; route via an interlocked MES/safety gateway`).
   - Audit trail registers policy denial with security alert level.
3. **Scenario 3: Perimeter Defense & CSRF Neutralization via Web Proxy**:
   - An attacker lures an authenticated operator to click a malicious link attempting a state-changing POST request.
   - The web proxy detects mismatched `Origin` vs `Host` headers and rejects the call with HTTP 403 (`cross-origin request refused`).
   - Attempts to pass path traversal vectors (`/api/execution/v1/../../../etc/shadow`) are intercepted at the gateway with HTTP 400 (`invalid path`).

---

## 3. Test Harness Architecture & Offline Mock Support

The test infrastructure in `tests/e2e/` is designed for:
1. **Zero-Dependency Offline Execution (`MOCK_AI=1`)**:
   Runs 100% locally without external API keys (Google Gemini, Neon DB, or Cloudflare R2).
2. **Dual-Mode Execution**:
   - **Live Service Mode**: When services are already running on ports `8001`, `8002`, `8080`, and `3000`, tests run against the live network endpoints.
   - **Self-Contained Mock Runtime (`mock_server.py`)**: When services are not yet running, the test harness can launch an internal HTTP server that faithfully implements the exact Cawrys interface contracts, schemas, policy logic, and error behaviors, allowing 100% test verification at any development stage.
3. **Structured Reporting**:
   Includes detailed test logs, ANSI color output, execution timing, and coverage reporting.

### Directory Layout
```
tests/e2e/
├── __init__.py
├── client.py                    # High-level HTTP client with auth, cookie, and tenant handling
├── conftest.py                  # Pytest fixtures and environment configuration
├── mock_server.py               # Standalone multi-service mock runtime
├── run_tests.sh                 # Executable bash test runner
├── runner.py                    # Comprehensive Python test discovery and execution engine
├── tier1_feature/
│   ├── __init__.py
│   ├── test_01_authentication.py
│   ├── test_02_ingestion.py
│   ├── test_03_extraction.py
│   ├── test_04_reasoning.py
│   ├── test_05_policies.py
│   ├── test_06_approvals.py
│   ├── test_07_audit_logs.py
│   └── test_08_web_proxy.py
├── tier2_boundary/
│   ├── __init__.py
│   ├── test_boundary_payloads.py
│   ├── test_boundary_security.py
│   ├── test_boundary_ssrf_csrf.py
│   └── test_boundary_concurrency.py
├── tier3_combination/
│   ├── __init__.py
│   ├── test_lifecycle_pipeline.py
│   └── test_tenant_isolation.py
└── tier4_scenarios/
    ├── __init__.py
    ├── test_scenario_incomplete_spec.py
    ├── test_scenario_safety_violation.py
    └── test_scenario_perimeter_defense.py
```

---

## 4. Running the Test Suite

### Option A: Standard Pytest Runner
```bash
# Run entire 4-tier suite
pytest tests/e2e -v

# Run specific tier
pytest tests/e2e/tier1_feature -v
pytest tests/e2e/tier2_boundary -v
pytest tests/e2e/tier3_combination -v
pytest tests/e2e/tier4_scenarios -v
```

### Option B: Unified Cawrys E2E Runner (Zero Dependencies)
```bash
# Automatically detects running services or spins up self-contained mock runtime
python3 tests/e2e/runner.py

# Or via bash wrapper
bash tests/e2e/run_tests.sh
```

### Environment Overrides (Optional)
```bash
export INTELLIGENCE_URL="http://localhost:8001"
export EXECUTION_URL="http://localhost:8002"
export EDGE_INGEST_URL="http://localhost:8080"
export WEB_URL="http://localhost:3000"
export DEMO_PASSWORD="cawrys-demo"
export EDGE_API_KEY="test-edge-key-12345"
export AUTH_SECRET="test-auth-secret-key-12345"
```
