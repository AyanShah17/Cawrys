# E2E Test Infra: Cawrys OpenHands Harness & Feature Restoration

## Test Philosophy
- Opaque-box, requirement-driven. Derives test cases from user requirements (`ORIGINAL_REQUEST.md`) and API specifications, not implementation internals.
- Verification mechanism: HTTP REST and SSE invocations, status codes, headers, JSON body assertions, and policy denial checks.
- Dual-mode execution: Native support for live FastAPI/Next.js services AND offline deterministic mock runtime (`MOCK_AI=1`).

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|---------------------|:------:|:------:|:------:|
| 1 | White-Labeling & Branding | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 2 | Login Throttling & Security | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 3 | User Management & Roles | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 4 | Operational Dashboard APIs | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 5 | Web Proxy REST Methods | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 6 | OpenHands Event Stream | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 7 | Action-Observation Loop | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 8 | Policy Gating & Approvals | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 9 | Model Routing (Argon/Flash) | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 10 | SSE Event Streaming API | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |

## Test Architecture
- **Runner**: `python3 tests/e2e/runner.py --tier [1|2|3|4|all]`
- **Framework**: Pytest with `httpx` client fixture (`CawrysClient`) and session fixtures in `tests/e2e/conftest.py`.
- **Directory Layout**:
  - `tests/e2e/tier1_feature/`: Isolated feature functionality tests.
    - `test_09_agent_harness.py`: OpenHands agent execution harness tests.
    - `test_10_snapshot_features.py`: Snapshot restored features tests.
  - `tests/e2e/tier2_boundary/`: Edge cases, invalid inputs, rate limit thresholds.
  - `tests/e2e/tier3_cross_feature/`: Interactions between user auth, policy, execution, and dashboard.
  - `tests/e2e/tier4_real_world/`: Complete end-to-end workflows.
  - `tests/test_sqlite_stress.py`: SQLite multi-process concurrency, WAL mode integrity.
  - `scripts/smoke_test.sh`: Live stack smoke test with 22 assertions.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Automated Incident Remediation | OpenHands harness, Gemini 4 Argon planning, Gemini 3.8 Flash log extraction, tool execution, audit trail | High |
| 2 | High-Risk Tool Human-in-the-Loop | Agent plan, policy interlock, status pause (`awaiting_approval`), approver action, session resume | High |
| 3 | Brute-Force Login Attack Throttling | Multiple failed logins, sliding window limit, HTTP 429 `Retry-After`, account security | Medium |
| 4 | White-Labeled Tenant Workspace | Custom brand env vars, dynamic UI branding, settings persistence | Medium |
| 5 | Concurrent Agent Execution Stress | Multiple concurrent agent sessions running under SQLite WAL adapter | High |

## Coverage Thresholds
- Tier 1: ≥5 test cases per feature (isolated functional happy path & basic validation).
- Tier 2: ≥5 test cases per feature covering boundaries (sliding window boundaries, forbidden connectors, max steps guard, invalid schemas).
- Tier 3: Pairwise coverage across major feature interactions (auth + proxy + harness + policy).
- Tier 4: ≥5 realistic end-to-end operational scenarios.
- Zero regression across all existing 79 E2E tests, 25 SQLite stress tests, and live smoke test.
