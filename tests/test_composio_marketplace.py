"""Comprehensive Automated Test Suite for Composio Marketplace & Connector Integration.

Tests:
1. Catalog listing of all 8 Free-Tier Composio integrations and metadata.
2. Free-Tier connection and automatic tool registration in /v1/tools.
3. Live test action execution via ComposioConnector in Free-Tier managed mode.
4. Playbook execution using a connected Composio tool (low-risk auto-run + medium-risk policy approval).
5. White-Label Pro OAuth guard in Free Tier vs enabled when COMPOSIO_TIER=pro.
6. Multi-tenant isolation for marketplace connections and auto-registered tools.
7. Role-Based Access Control (viewer/approver blocked with 403 on mutate; viewer allowed on GET).
8. Disconnect cleanup (connection removed and composio_* tools deregistered).
9. Error handling (404 on unknown app_key or testing an unconnected integration) and audit trail verification.
"""
import os
import pytest
from fastapi.testclient import TestClient

os.environ["MOCK_AI"] = "1"
os.environ["SQLITE_PATH"] = "/tmp/cawrys_test_composio_marketplace.db"
os.environ["AUTH_SECRET"] = "0123456789012345678901234567890123456789012345678901234567890123"

from services.execution.app.auth import make_token
from services.execution.app.main import app
from services.execution.app.sqlite_adapter import get_connection

TENANT_A = "00000000-0000-0000-0000-000000000001"
TENANT_B = "00000000-0000-0000-0000-000000000002"


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    """Ensure clean marketplace state and default Free Tier env before each test."""
    monkeypatch.setenv("COMPOSIO_TIER", "free")
    monkeypatch.setenv("COMPOSIO_WHITELABEL_ENABLED", "0")
    monkeypatch.setenv("COMPOSIO_API_KEY", "")
    with get_connection() as c:
        c.execute("INSERT OR IGNORE INTO tenants (id, name) VALUES (%s, %s)", (TENANT_A, "Demo Tenant"))
        c.execute("INSERT OR IGNORE INTO tenants (id, name) VALUES (%s, %s)", (TENANT_B, "Second Tenant"))
        c.execute("DELETE FROM marketplace_connections")
        c.execute("DELETE FROM tools WHERE connector = 'composio'")
        c.commit()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def admin_token():
    return make_token("admin-1", TENANT_A, "admin", "admin@cawrys.local")


@pytest.fixture
def engineer_token():
    return make_token("eng-1", TENANT_A, "engineer", "engineer@cawrys.local")


@pytest.fixture
def approver_token():
    return make_token("app-1", TENANT_A, "approver", "approver@cawrys.local")


@pytest.fixture
def viewer_token():
    return make_token("view-1", TENANT_A, "viewer", "viewer@cawrys.local")


@pytest.fixture
def tenant_b_admin_token():
    return make_token("admin-b", TENANT_B, "admin", "admin@tenant-b.local")


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_list_marketplace_catalog(client, viewer_token):
    """Verify catalog returns composio.dev integrations and industrial FastMCP servers with counts and filters."""
    resp = client.get("/v1/marketplace/apps?limit=0", headers=auth_header(viewer_token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["tier"] == "free"
    assert data["whitelabel_enabled"] is False
    assert data["api_key_configured"] is False
    assert "composio.dev" in data["composio_base_url"]

    # Verify counts
    counts = data["counts"]
    assert counts["total"] >= 30
    assert counts["composio"] >= 24
    assert counts["fastmcp"] == 6
    assert counts["connected"] == 0

    apps = data["apps"]
    assert len(apps) == counts["total"]
    keys = {a["key"] for a in apps}
    expected_composio_baseline = {"slack", "github", "gmail", "googlesheets", "linear", "jira", "notion", "erp_webhook"}
    assert expected_composio_baseline.issubset(keys)

    expected_fastmcp_keys = {"sap_s4hana", "siemens_xcelerator", "rockwell_factorytalk", "dassault_3dexperience", "ptc_windchill", "oracle_scm"}
    assert expected_fastmcp_keys.issubset(keys)

    for a in apps:
        assert a["connected"] is False
        assert a["connection"] is None
        assert len(a["tools"]) >= 1
        if a["provider"] == "composio" and a.get("whitelabel_ready") is not None:
            assert a.get("whitelabel_ready") is True

    # Verify filtering by provider=composio
    resp_composio = client.get("/v1/marketplace/apps?provider=composio&limit=0", headers=auth_header(viewer_token))
    assert resp_composio.status_code == 200
    comp_data = resp_composio.json()
    assert len(comp_data["apps"]) == counts["composio"]
    assert all(a["provider"] == "composio" for a in comp_data["apps"])

    # Verify filtering by provider=fastmcp
    resp_fastmcp = client.get("/v1/marketplace/apps?provider=fastmcp", headers=auth_header(viewer_token))
    assert resp_fastmcp.status_code == 200
    fastmcp_data = resp_fastmcp.json()
    assert len(fastmcp_data["apps"]) == 6
    assert all(a["provider"] == "fastmcp" for a in fastmcp_data["apps"])


def test_connect_free_tier_and_auto_register_tools(client, engineer_token):
    """Connecting a Free-Tier integration persists connection and registers its tools in /v1/tools."""
    resp = client.post(
        "/v1/marketplace/connect",
        headers=auth_header(engineer_token),
        json={"app_key": "slack", "auth_mode": "free_managed", "entity_id": "plant-floor-1"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["app_key"] == "slack"
    assert "composio_slack_send_message" in body["registered_tools"]
    assert body["connection"]["status"] == "connected"
    assert body["connection"]["auth_mode"] == "free_managed"
    assert body["connection"]["entity_id"] == "plant-floor-1"

    # Verify /v1/marketplace/apps marks slack as connected
    catalog = client.get("/v1/marketplace/apps", headers=auth_header(engineer_token)).json()
    slack_app = next(a for a in catalog["apps"] if a["key"] == "slack")
    assert slack_app["connected"] is True
    assert slack_app["connection"]["connected_by"] == "engineer@cawrys.local"

    # Verify /v1/tools includes composio_slack_send_message AND existing seeded demo tools
    tools = client.get("/v1/tools", headers=auth_header(engineer_token)).json()
    tool_names = {t["name"] for t in tools}
    assert "composio_slack_send_message" in tool_names
    assert "erp_lookup_inventory" in tool_names
    slack_tool = next(t for t in tools if t["name"] == "composio_slack_send_message")
    assert slack_tool["connector"] == "composio"
    assert slack_tool["risk"] == "low"


def test_execute_connected_composio_action(client, engineer_token):
    """Testing a connected Composio integration executes through ComposioConnector."""
    client.post(
        "/v1/marketplace/connect",
        headers=auth_header(engineer_token),
        json={"app_key": "github", "auth_mode": "free_managed"},
    )
    test_resp = client.post("/v1/marketplace/test/github", headers=auth_header(engineer_token))
    assert test_resp.status_code == 200
    res = test_resp.json()
    assert res["ok"] is True
    assert res["app_key"] == "github"
    assert res["result"]["ok"] is True
    assert res["result"]["provider"] == "composio"
    assert res["result"]["connector"] == "composio"
    assert res["result"]["tier"] == "free"
    assert res["result"]["action"] == "composio_github_create_issue"


def test_playbook_execution_with_composio_tools(client, engineer_token, approver_token):
    """Playbooks can invoke auto-registered Composio tools with full policy enforcement."""
    # Connect Slack (low risk) and ERP Webhook (medium risk)
    client.post("/v1/marketplace/connect", headers=auth_header(engineer_token), json={"app_key": "slack"})
    client.post("/v1/marketplace/connect", headers=auth_header(engineer_token), json={"app_key": "erp_webhook"})

    # Create a playbook combining low-risk Slack and medium-risk ERP sync
    pb_resp = client.post(
        "/v1/playbooks",
        headers=auth_header(engineer_token),
        json={
            "name": "composio-order-sync",
            "steps": [
                {
                    "tool": "composio_slack_send_message",
                    "params": {"channel": "#orders", "text": "Syncing order $inputs.order_id"},
                },
                {
                    "tool": "composio_erp_sync_order",
                    "params": {"order_id": "$inputs.order_id", "quantity": "$inputs.quantity"},
                },
            ],
        },
    )
    assert pb_resp.status_code == 200

    # Run playbook as engineer: step 0 (Slack, low risk) succeeds, step 1 (ERP, medium risk) pauses for approval
    run_resp = client.post(
        "/v1/executions",
        headers=auth_header(engineer_token),
        json={"playbook": "composio-order-sync", "inputs": {"order_id": "ORD-77", "quantity": 25}},
    )
    assert run_resp.status_code == 200
    run_data = run_resp.json()
    assert run_data["status"] == "awaiting_approval"
    assert len(run_data["results"]) == 1
    assert run_data["results"][0]["tool"] == "composio_slack_send_message"
    assert run_data["results"][0]["result"]["provider"] == "composio"

    # Approver approves execution -> step 1 (composio_erp_sync_order) runs to completion
    exec_id = run_data["execution_id"]
    approve_resp = client.post(f"/v1/executions/{exec_id}/approve", headers=auth_header(approver_token))
    assert approve_resp.status_code == 200
    app_data = approve_resp.json()
    assert app_data["status"] == "succeeded"
    assert len(app_data["results"]) == 2
    assert app_data["results"][1]["tool"] == "composio_erp_sync_order"
    assert app_data["results"][1]["result"]["provider"] == "composio"


def test_whitelabel_pro_guard_and_upgrade(client, admin_token, monkeypatch):
    """White-label custom OAuth is blocked on Free Tier and unlocked when COMPOSIO_TIER=pro."""
    # Blocked in Free Tier
    blocked_resp = client.post(
        "/v1/marketplace/connect",
        headers=auth_header(admin_token),
        json={
            "app_key": "linear",
            "auth_mode": "whitelabel_oauth",
            "custom_client_id": "acme-client-id",
            "custom_client_secret": "acme-secret",
        },
    )
    assert blocked_resp.status_code in (400, 402)
    assert "COMPOSIO_TIER=pro" in blocked_resp.json()["detail"]

    # Enable Pro Tier
    monkeypatch.setenv("COMPOSIO_TIER", "pro")
    monkeypatch.setenv("COMPOSIO_WHITELABEL_ENABLED", "1")

    catalog = client.get("/v1/marketplace/apps", headers=auth_header(admin_token)).json()
    assert catalog["tier"] == "pro"
    assert catalog["whitelabel_enabled"] is True

    pro_resp = client.post(
        "/v1/marketplace/connect",
        headers=auth_header(admin_token),
        json={
            "app_key": "linear",
            "auth_mode": "whitelabel_oauth",
            "entity_id": "acme-org",
            "custom_client_id": "acme-client-id",
            "custom_client_secret": "acme-secret",
        },
    )
    assert pro_resp.status_code == 200
    assert pro_resp.json()["connection"]["auth_mode"] == "whitelabel_oauth"


def test_tenant_isolation(client, admin_token, tenant_b_admin_token):
    """Connections and auto-registered Composio tools are strictly isolated per tenant."""
    client.post("/v1/marketplace/connect", headers=auth_header(admin_token), json={"app_key": "notion"})

    # Tenant A sees Notion connected
    cat_a = client.get("/v1/marketplace/apps", headers=auth_header(admin_token)).json()
    assert next(a for a in cat_a["apps"] if a["key"] == "notion")["connected"] is True

    # Tenant B sees Notion disconnected and does not have composio_notion_create_page in tools
    cat_b = client.get("/v1/marketplace/apps", headers=auth_header(tenant_b_admin_token)).json()
    assert next(a for a in cat_b["apps"] if a["key"] == "notion")["connected"] is False

    tools_b = client.get("/v1/tools", headers=auth_header(tenant_b_admin_token)).json()
    assert "composio_notion_create_page" not in {t["name"] for t in tools_b}


def test_rbac_enforcement(client, viewer_token, approver_token):
    """Viewers and approvers cannot connect, test, or disconnect integrations (403)."""
    for token in (viewer_token, approver_token):
        assert (
            client.post("/v1/marketplace/connect", headers=auth_header(token), json={"app_key": "slack"}).status_code
            == 403
        )
        assert client.post("/v1/marketplace/test/slack", headers=auth_header(token)).status_code == 403
        assert client.delete("/v1/marketplace/connections/slack", headers=auth_header(token)).status_code == 403


def test_disconnect_cleanup(client, engineer_token):
    """Disconnecting an app removes the connection row and deregisters its composio_* tools."""
    client.post("/v1/marketplace/connect", headers=auth_header(engineer_token), json={"app_key": "jira"})
    tools_before = {t["name"] for t in client.get("/v1/tools", headers=auth_header(engineer_token)).json()}
    assert "composio_jira_create_issue" in tools_before

    del_resp = client.delete("/v1/marketplace/connections/jira", headers=auth_header(engineer_token))
    assert del_resp.status_code == 200
    assert del_resp.json()["ok"] is True

    # Tool is removed and app is no longer connected
    tools_after = {t["name"] for t in client.get("/v1/tools", headers=auth_header(engineer_token)).json()}
    assert "composio_jira_create_issue" not in tools_after

    cat_after = client.get("/v1/marketplace/apps", headers=auth_header(engineer_token)).json()
    assert next(a for a in cat_after["apps"] if a["key"] == "jira")["connected"] is False


def test_not_found_and_audit_trail(client, admin_token):
    """Unknown apps or testing unconnected apps return 404, and lifecycle events are audited."""
    assert (
        client.post("/v1/marketplace/connect", headers=auth_header(admin_token), json={"app_key": "unknown_app"}).status_code
        == 404
    )
    assert client.post("/v1/marketplace/test/googlesheets", headers=auth_header(admin_token)).status_code == 404

    client.post("/v1/marketplace/connect", headers=auth_header(admin_token), json={"app_key": "googlesheets"})
    client.post("/v1/marketplace/test/googlesheets", headers=auth_header(admin_token))
    client.delete("/v1/marketplace/connections/googlesheets", headers=auth_header(admin_token))

    with get_connection() as c:
        events = [
            r["event"]
            for r in c.execute(
                "select event from audit_log where tenant_id=%s and event like 'marketplace.%%' order by id desc limit 10",
                (TENANT_A,),
            ).fetchall()
        ]
    assert "marketplace.connected" in events
    assert "marketplace.tested" in events
    assert "marketplace.disconnected" in events
