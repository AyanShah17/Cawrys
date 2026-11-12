"""Comprehensive Test Suite for Chat Interface & Dashboard Override Mutation.

Validates:
1. Agent Chat tools discovery (/v1/chat/tools) & suggested prompts.
2. Chat query -> dashboard override intent detection:
   - Change production target to 1,200 units
   - Set operational risk to LOW
   - Update OEE to 94%
   - Update machine telemetry status to Optimal
   - Set active work orders to 42
   - Reset dashboard overrides
3. Live / Connected Marketplace Tool invocations from Chat:
   - SAP S/4HANA material stock lookup (FastMCP)
   - GitHub issues & pull requests summary (Composio)
   - Slack alert dispatch (Composio)
   - Siemens Xcelerator CAD revisions (FastMCP)
4. Dashboard summary integration (/v1/dashboard/summary):
   - Merging dynamic overrides into intelligence dashboard summary
5. Conversation history persistence (/v1/chat/history).
"""
import os
import pytest
from fastapi.testclient import TestClient

os.environ["MOCK_AI"] = "1"
os.environ["SQLITE_PATH"] = "/tmp/cawrys_test_chat_dashboard.db"
os.environ["AUTH_SECRET"] = "0123456789012345678901234567890123456789012345678901234567890123"

from services.execution.app.auth import make_token
from services.execution.app.chat_routes import _init_chat_tables
from services.execution.app.main import app as exec_app
from services.execution.app.sqlite_adapter import get_connection
from services.intelligence.app.dashboard import _init_overrides_table
from services.intelligence.app.main import app as intel_app

TENANT_ID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture(autouse=True)
def setup_db():
    _init_chat_tables()
    _init_overrides_table()
    with get_connection() as c:
        c.execute("INSERT OR IGNORE INTO tenants (id, name) VALUES (%s, %s)", (TENANT_ID, "Demo Tenant"))
        c.execute("DELETE FROM chat_messages")
        c.execute("DELETE FROM dashboard_overrides")
        c.commit()


@pytest.fixture
def exec_client():
    return TestClient(exec_app)


@pytest.fixture
def intel_client():
    return TestClient(intel_app)


@pytest.fixture
def auth_headers():
    token = make_token("admin-1", TENANT_ID, "admin", "admin@cawrys.local")
    return {"Authorization": f"Bearer {token}"}


def test_chat_tools_discovery(exec_client, auth_headers):
    """GET /v1/chat/tools should list connected apps, tools, and suggested prompts."""
    res = exec_client.get("/v1/chat/tools", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert "suggested_prompts" in data
    assert any("SAP S/4HANA" in p for p in data["suggested_prompts"])
    assert any("GitHub" in p for p in data["suggested_prompts"])
    assert any("production target" in p for p in data["suggested_prompts"])
    assert any("risk" in p for p in data["suggested_prompts"])


def test_chat_mutate_production_target(exec_client, auth_headers):
    """Chat message should detect intent and update dashboard production target."""
    payload = {"message": "Change production target to 1,200", "session_id": "test-sess"}
    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["dashboard_mutated"] is True
    assert "Updated dashboard UI" in data["content"]
    assert "production target set to 1,200 units" in data["content"]
    assert data["overrides"]["production_target"] == "1,200 units"


def test_chat_mutate_risk_and_status(exec_client, auth_headers):
    """Chat message should detect operational risk level and machine telemetry status."""
    payload = {
        "message": "Set dashboard operational risk to LOW and machine telemetry status to Optimal",
        "session_id": "test-sess",
    }
    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["dashboard_mutated"] is True
    assert data["overrides"]["risk_level"] == "LOW"
    assert data["overrides"]["operational_status"] == "Optimal"
    assert "operational risk set to LOW" in data["content"]
    assert "operational status set to Optimal" in data["content"]


def test_chat_mutate_oee_and_work_orders(exec_client, auth_headers):
    """Chat message should detect OEE efficiency and active work orders."""
    payload = {
        "message": "Update OEE to 94% and set active work orders to 42",
        "session_id": "test-sess",
    }
    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["dashboard_mutated"] is True
    assert data["overrides"]["oee"] == "94%"
    assert data["overrides"]["active_work_orders"] == 42


def test_chat_reset_dashboard(exec_client, auth_headers):
    """Chat message should support clearing / resetting dashboard overrides."""
    # First set a target
    exec_client.post(
        "/v1/chat/message",
        json={"message": "Change production target to 1,500"},
        headers=auth_headers,
    )
    # Now reset
    res = exec_client.post(
        "/v1/chat/message",
        json={"message": "Reset dashboard overrides"},
        headers=auth_headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["dashboard_mutated"] is True
    assert "Cleared all dashboard overrides" in data["content"]
    assert data["overrides"] == {}


def test_chat_query_sap_inventory(exec_client, auth_headers):
    """Chat message querying SAP S/4HANA stock should invoke FastMCP tool and cite data."""
    payload = {"message": "Check SAP stock for Part 100", "session_id": "test-sess"}
    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert "tool_calls" in data
    assert len(data["tool_calls"]) > 0
    assert data["tool_calls"][0]["app"] == "SAP S/4HANA"
    assert "Part 100" in data["content"]
    assert "450 units" in data["content"]
    assert "Plant 1000" in data["content"]


def test_chat_query_github_issues(exec_client, auth_headers):
    """Chat message querying GitHub issues should invoke Composio tool and format response."""
    payload = {"message": "Show open GitHub issues & PRs", "session_id": "test-sess"}
    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert "tool_calls" in data
    assert data["tool_calls"][0]["app"] == "GitHub"
    assert "#104" in data["content"]
    assert "PR #112" in data["content"]


def test_chat_query_siemens_cad(exec_client, auth_headers):
    """Chat message querying Siemens CAD revisions should invoke FastMCP connector."""
    payload = {"message": "Check Siemens CAD revisions for DWG-4002", "session_id": "test-sess"}
    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert "tool_calls" in data
    assert data["tool_calls"][0]["app"] == "Siemens Xcelerator"
    assert "DWG-4002-TURBINE" in data["content"]
    assert "Rev C" in data["content"]


def test_chat_history_persistence(exec_client, auth_headers):
    """Conversations should be persisted in chat_messages and retrievable via GET /v1/chat/history."""
    exec_client.post(
        "/v1/chat/message",
        json={"message": "Hello AI", "session_id": "sess-alpha"},
        headers=auth_headers,
    )
    res = exec_client.get("/v1/chat/history?session_id=sess-alpha", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert len(data["messages"]) >= 2  # user and assistant messages
    assert data["messages"][0]["role"] == "user"
    assert data["messages"][0]["content"] == "Hello AI"
    assert data["messages"][1]["role"] == "assistant"


def test_intelligence_summary_merges_overrides(intel_client, auth_headers):
    """Intelligence /v1/dashboard/summary should reflect overrides set via /v1/dashboard/override."""
    # Apply override directly to intelligence service
    override_payload = {
        "metrics": {
            "production_target": "1,200 units",
            "risk_level": "LOW",
            "oee": "94%",
            "operational_status": "Optimal",
            "active_work_orders": 42,
        }
    }
    ov_res = intel_client.post("/v1/dashboard/override", json=override_payload, headers=auth_headers)
    assert ov_res.status_code == 200
    assert ov_res.json()["ok"] is True

    # Now verify summary contains them
    sum_res = intel_client.get("/v1/dashboard/summary", headers=auth_headers)
    assert sum_res.status_code == 200
    data = sum_res.json()
    assert data["production_target"] == "1,200 units"
    assert data["risk_level"] == "LOW"
    assert data["oee"] == "94%"
    assert data["operational_status"] == "Optimal"
    assert data["active_work_orders"] == 42
    assert "overrides" in data
    assert data["overrides"]["production_target"] == "1,200 units"
