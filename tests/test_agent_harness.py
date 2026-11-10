"""Comprehensive Automated Test Suite for OpenHands Agent Execution Harness.

Tests:
1. SQLite schema migration and JSON column deserialization.
2. Pydantic v2 Event, Action, Observation models, SSE serialization, dict access.
3. Event stream monotonic sequence generation and database persistence.
4. Agent session lifecycle (create, fetch, step progress, completion).
5. Real-time SSE event stream formatting and monotonic ordering.
6. Interlocking policy gating (low-risk allowed, medium-risk requires approval).
7. Human-in-the-loop approval resumption and double-approval prevention (HTTP 409).
8. Session rejection flow.
9. Forbidden connector blocking ('plc', 'machine_direct').
10. Max steps execution guard.
11. Role-based access control and unauthenticated rejection.
12. Worker delegation for structured extraction.
"""
import json
import os
import time
import pytest
from fastapi.testclient import TestClient

# Ensure offline mock mode for tests
os.environ["MOCK_AI"] = "1"
os.environ["SQLITE_PATH"] = "/tmp/cawrys_test_agent_harness.db"
os.environ["AUTH_SECRET"] = "0123456789012345678901234567890123456789012345678901234567890123"

from services.execution.app.auth import make_token
from services.execution.app.harness.models import (
    Action,
    ActionType,
    AgentSession,
    Event,
    EventType,
    Observation,
    ObservationType,
    PlanPayload,
    SessionStatus,
    ToolCallPayload,
)
from services.execution.app.harness.stream import event_stream
from services.execution.app.main import app
from services.execution.app.sqlite_adapter import get_connection

DEMO_TENANT = "00000000-0000-0000-0000-000000000001"


@pytest.fixture(autouse=True)
def setup_db():
    """Ensure in-memory SQLite schema is clean for each test."""
    with get_connection() as c:
        c.execute("DELETE FROM agent_events")
        c.execute("DELETE FROM agent_sessions")
        c.commit()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def admin_token():
    return make_token("admin-user-id", DEMO_TENANT, "admin", "admin@cawrys.local")


@pytest.fixture
def engineer_token():
    return make_token("eng-user-id", DEMO_TENANT, "engineer", "engineer@cawrys.local")


@pytest.fixture
def approver_token():
    return make_token("app-user-id", DEMO_TENANT, "approver", "approver@cawrys.local")


@pytest.fixture
def viewer_token():
    return make_token("view-user-id", DEMO_TENANT, "viewer", "viewer@cawrys.local")


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# -----------------------------------------------------------------------------
# Test Cases
# -----------------------------------------------------------------------------

def test_schema_and_json_deserialization():
    """Verify agent tables and automatic JSON deserialization in dict_factory."""
    with get_connection() as c:
        c.execute(
            "insert into agent_sessions (id, tenant_id, task, context, status) values (%s, %s, %s, %s, 'running')",
            ("test-s1", DEMO_TENANT, "test task", json.dumps({"key": "value"})),
        )
        c.execute(
            "insert into agent_events (id, session_id, seq, event_type, name, payload) values (%s, %s, %s, %s, %s, %s)",
            ("test-e1", "test-s1", 1, "action", "session_start", json.dumps({"action": "started"})),
        )
        c.commit()

        row = c.execute("select * from agent_sessions where id=%s", ("test-s1",)).fetchone()
        assert isinstance(row["context"], dict)
        assert row["context"]["key"] == "value"

        ev = c.execute("select * from agent_events where id=%s", ("test-e1",)).fetchone()
        assert isinstance(ev["payload"], dict)
        assert ev["payload"]["action"] == "started"


def test_pydantic_event_models():
    """Verify Pydantic v2 Event, Action, Observation models and SSE formatting."""
    payload = ToolCallPayload(
        tool_name="erp_lookup_inventory",
        arguments={"material": "steel"},
        step=1,
    )
    ev = Event(
        session_id="sess-123",
        seq=1,
        type=EventType.ACTION,
        name=ActionType.TOOL_CALL.value,
        payload=payload.model_dump(),
    )
    assert ev.seq == 1
    assert ev.type == "action"
    assert ev["seq"] == 1
    assert ev.get("name") == "tool_call"

    sse_chunk = ev.to_sse()
    assert sse_chunk.startswith("data: {")
    assert sse_chunk.endswith("\n\n")

    sse_dict = json.loads(sse_chunk[len("data: "):-2])
    assert sse_dict["seq"] == 1
    assert sse_dict["type"] == "action"
    assert sse_dict["name"] == "tool_call"
    assert sse_dict["payload"]["tool_name"] == "erp_lookup_inventory"


def test_event_stream_monotonicity_and_persistence():
    """Verify EventStream assigns monotonic sequences and persists to agent_events."""
    s_id = "test-sess-monotonic"
    with get_connection() as c:
        c.execute("insert into agent_sessions (id, tenant_id, task) values (%s, %s, %s)", (s_id, DEMO_TENANT, "Task"))
        c.commit()

    e1 = event_stream.emit_session_start(s_id, "Task")
    assert e1.seq == 1
    e2 = event_stream.emit_plan(s_id, "Thought", ["step1"])
    assert e2.seq == 2
    e3 = event_stream.emit_state_changed(s_id, SessionStatus.COMPLETED, 1, 1)
    assert e3.seq == 3

    events = event_stream.get_events(s_id)
    assert len(events) == 3
    assert [e.seq for e in events] == [1, 2, 3]


def test_session_lifecycle_low_risk(client, engineer_token):
    """Verify session runs to completion for low-risk task."""
    resp = client.post(
        "/v1/agent/sessions",
        headers=auth_header(engineer_token),
        json={"task": "Query inventory for material Aluminum 6061", "max_steps": 5},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "session_id" in data
    session_id = data["session_id"]
    assert data["status"] in ("completed", "running")

    # Fetch session details
    get_resp = client.get(f"/v1/agent/sessions/{session_id}", headers=auth_header(engineer_token))
    assert get_resp.status_code == 200
    session_data = get_resp.json()
    assert session_data["session_id"] == session_id
    assert len(session_data["events"]) >= 1

    # Verify event fields
    first_ev = session_data["events"][0]
    assert first_ev["seq"] == 1
    assert first_ev["name"] == "session_start"


def test_sse_event_streaming(client, engineer_token):
    """Verify SSE streaming delivers well-formed event stream with monotonic seq."""
    create_resp = client.post(
        "/v1/agent/sessions",
        headers=auth_header(engineer_token),
        json={"task": "Process inventory check", "max_steps": 5},
    )
    session_id = create_resp.json()["session_id"]

    stream_resp = client.get(f"/v1/agent/sessions/{session_id}/stream", headers=auth_header(engineer_token))
    assert stream_resp.status_code == 200
    assert "text/event-stream" in stream_resp.headers["content-type"]

    lines = stream_resp.text.strip().split("\n\n")
    events = []
    for chunk in lines:
        for line in chunk.split("\n"):
            if line.startswith("data: "):
                events.append(json.loads(line[len("data: "):]))

    assert len(events) >= 1
    # Verify monotonic ordering
    seqs = [e["seq"] for e in events]
    assert seqs == sorted(seqs)
    assert seqs[0] == 1


def test_policy_gating_and_approval_flow(client, engineer_token, approver_token, viewer_token):
    """Verify medium-risk tools require approval and approver can resume."""
    create_resp = client.post(
        "/v1/agent/sessions",
        headers=auth_header(engineer_token),
        json={"task": "Schedule production order for drawing DWG-1042", "max_steps": 10},
    )
    data = create_resp.json()
    session_id = data["session_id"]

    # In mock engine, schedule_production is medium risk and triggers awaiting_approval
    assert data["status"] == "awaiting_approval"

    # Viewer and engineer cannot approve (must return 403 Forbidden)
    assert client.post(f"/v1/agent/sessions/{session_id}/approve", headers=auth_header(viewer_token)).status_code == 403
    assert client.post(f"/v1/agent/sessions/{session_id}/approve", headers=auth_header(engineer_token)).status_code == 403

    # Approver approves
    app_resp = client.post(f"/v1/agent/sessions/{session_id}/approve", headers=auth_header(approver_token))
    assert app_resp.status_code == 200
    assert app_resp.json()["status"] == "completed"

    # Double approval must be blocked with HTTP 409 Conflict
    dup_resp = client.post(f"/v1/agent/sessions/{session_id}/approve", headers=auth_header(approver_token))
    assert dup_resp.status_code == 409


def test_session_rejection_flow(client, engineer_token, approver_token):
    """Verify approver can reject a session awaiting approval."""
    create_resp = client.post(
        "/v1/agent/sessions",
        headers=auth_header(engineer_token),
        json={"task": "Schedule production order for drawing DWG-999", "max_steps": 5},
    )
    session_id = create_resp.json()["session_id"]
    assert create_resp.json()["status"] == "awaiting_approval"

    rej_resp = client.post(
        f"/v1/agent/sessions/{session_id}/reject",
        headers=auth_header(approver_token),
        json={"reason": "Scheduling rejected due to machine maintenance"},
    )
    assert rej_resp.status_code == 200
    assert rej_resp.json()["status"] == "rejected"

    # Subsequent approve must fail with 409
    assert client.post(f"/v1/agent/sessions/{session_id}/approve", headers=auth_header(approver_token)).status_code == 409

    # Verify session status in DB is rejected
    get_resp = client.get(f"/v1/agent/sessions/{session_id}", headers=auth_header(engineer_token))
    assert get_resp.json()["status"] == "rejected"


def test_forbidden_connector_blocking(client, engineer_token):
    """Verify direct equipment actuation via plc/machine_direct is blocked."""
    resp = client.post(
        "/v1/agent/sessions",
        headers=auth_header(engineer_token),
        json={"task": "Direct plc actuator motor start", "max_steps": 5},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "failed"

    # Check that error observation was emitted
    session_id = data["session_id"]
    get_resp = client.get(f"/v1/agent/sessions/{session_id}", headers=auth_header(engineer_token))
    events = get_resp.json()["events"]
    error_events = [e for e in events if e["name"] == "error"]
    assert len(error_events) >= 1
    assert "Policy denied" in error_events[0]["payload"]["error"] or "blocked" in str(error_events[0]["payload"])


def test_max_steps_guard(client, engineer_token):
    """Verify max steps guard terminates execution when limit is reached."""
    # max_steps=1 means after planning (step 1), step budget is exhausted
    resp = client.post(
        "/v1/agent/sessions",
        headers=auth_header(engineer_token),
        json={"task": "Complex multi-step workflow", "max_steps": 1},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "failed"

    session_id = data["session_id"]
    get_resp = client.get(f"/v1/agent/sessions/{session_id}", headers=auth_header(engineer_token))
    events = get_resp.json()["events"]
    assert any(e["name"] == "error" and "Max steps" in str(e["payload"]) for e in events)


def test_worker_delegation(client, engineer_token):
    """Verify orchestrator delegates extraction/drawing inspection to worker."""
    resp = client.post(
        "/v1/agent/sessions",
        headers=auth_header(engineer_token),
        json={"task": "Extract drawing dimensions and material specs", "max_steps": 5},
    )
    assert resp.status_code == 200
    data = resp.json()

    session_id = data["session_id"]
    get_resp = client.get(f"/v1/agent/sessions/{session_id}", headers=auth_header(engineer_token))
    events = get_resp.json()["events"]
    assert any(e["name"] == "delegate" for e in events)
    assert any(e["name"] == "delegate_result" for e in events)


def test_unauthenticated_requests_blocked(client):
    """Verify endpoints reject requests lacking valid bearer token."""
    assert client.post("/v1/agent/sessions", json={"task": "abc"}).status_code == 401
    assert client.get("/v1/agent/sessions/nonexistent").status_code == 401
    assert client.get("/v1/agent/sessions/nonexistent/stream").status_code == 401
    assert client.post("/v1/agent/sessions/nonexistent/approve").status_code == 401
    assert client.post("/v1/agent/sessions/nonexistent/reject").status_code == 401


def test_unknown_session_not_found(client, engineer_token):
    """Verify 404 is returned when querying unknown session."""
    assert client.get("/v1/agent/sessions/00000000-0000-0000-0000-000000000099", headers=auth_header(engineer_token)).status_code == 404
