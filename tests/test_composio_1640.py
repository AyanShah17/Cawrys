"""Comprehensive Test Suite for Composio 1,640+ Toolkits Catalog & Direct Connect Integration.

Verifies:
1. Catalog size: len(COMPOSIO_TOOLKITS_1640) >= 1640 with complete schema and uniqueness.
2. Helper functions: get_composio_toolkits, get_composio_toolkit_by_key, get_toolkit_categories.
3. GET /v1/marketplace/apps:
   - counts.composio >= 1640
   - counts.fastmcp == 6
   - counts.total >= 1646
   - pagination (limit=24, offset=0, has_more=True)
   - category filtering across 1640 toolkits
   - search filtering across 1640 toolkits
   - provider filtering (all, composio, fastmcp)
4. POST /v1/marketplace/connect:
   - Returns status and redirect_url containing composio.dev
   - Auto-registers tools in /v1/tools
5. POST /v1/marketplace/test/{app_key}:
   - Executes via ComposioConnector and returns structured result
6. Disconnect & cleanup:
   - DELETE /v1/marketplace/connections/{app_key} removes connection and tools
7. Multi-tenant isolation & RBAC enforcement across 1640 toolkits catalog.
"""
import os
import pytest
from fastapi.testclient import TestClient

os.environ["MOCK_AI"] = "1"
os.environ["SQLITE_PATH"] = "/tmp/cawrys_test_composio_1640.db"
os.environ["AUTH_SECRET"] = "0123456789012345678901234567890123456789012345678901234567890123"

from services.execution.app.auth import make_token
from services.execution.app.main import app
from services.execution.app.sqlite_adapter import get_connection

TENANT_A = "00000000-0000-0000-0000-000000000001"
TENANT_B = "00000000-0000-0000-0000-000000000002"


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    """Ensure clean database and default environment before each test."""
    monkeypatch.setenv("COMPOSIO_TIER", "free")
    monkeypatch.setenv("COMPOSIO_WHITELABEL_ENABLED", "0")
    monkeypatch.setenv("COMPOSIO_API_KEY", "")
    with get_connection() as c:
        c.execute("INSERT OR IGNORE INTO tenants (id, name) VALUES (%s, %s)", (TENANT_A, "Demo Tenant"))
        c.execute("INSERT OR IGNORE INTO tenants (id, name) VALUES (%s, %s)", (TENANT_B, "Second Tenant"))
        c.execute("DELETE FROM marketplace_connections")
        c.execute("DELETE FROM tools WHERE connector in ('composio', 'fastmcp')")
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


# ============================================================================
# 1. Dataset & Catalog Structure Verification
# ============================================================================
def test_composio_1640_catalog_dataset_integrity():
    """Verify COMPOSIO_TOOLKITS_1640 has >= 1640 toolkits with valid metadata and tools."""
    from services.execution.app.composio_toolkits_catalog import (
        COMPOSIO_TOOLKITS_1640,
        get_composio_toolkit_by_key,
        get_composio_toolkits,
        get_toolkit_categories,
    )

    total_toolkits = len(COMPOSIO_TOOLKITS_1640)
    assert total_toolkits >= 1640, f"Expected >= 1640 toolkits, got {total_toolkits}"

    keys = set()
    categories = set()

    for item in COMPOSIO_TOOLKITS_1640:
        key = item["key"]
        assert key not in keys, f"Duplicate toolkit key detected: {key}"
        keys.add(key)

        assert item["name"], f"Toolkit {key} has empty name"
        assert item["category"], f"Toolkit {key} has empty category"
        categories.add(item["category"])

        assert item["provider"] == "composio", f"Toolkit {key} provider must be 'composio'"
        assert item["description"], f"Toolkit {key} has empty description"
        assert item.get("composio_app"), f"Toolkit {key} missing composio_app"
        assert isinstance(item.get("auth_schemes"), list) and len(item["auth_schemes"]) > 0
        assert "composio.dev" in item.get("docs_url", "")
        assert item.get("default_action"), f"Toolkit {key} missing default_action"

        tools = item.get("tools")
        assert isinstance(tools, list) and len(tools) >= 1, f"Toolkit {key} must have at least 1 tool"
        for t in tools:
            assert t.get("name"), f"Tool in {key} missing name"
            assert t.get("action"), f"Tool in {key} missing action"
            assert t.get("description"), f"Tool in {key} missing description"
            assert t.get("risk") in ("low", "medium", "high")
            assert t.get("connector") == "composio"
            assert t.get("secret_ref")
            assert isinstance(t.get("input_schema"), dict)
            assert t["input_schema"].get("type") == "object"

    # Verify category distribution
    assert len(categories) >= 10, f"Expected diverse taxonomy (>= 10 categories), got {len(categories)}"
    cat_summary = get_toolkit_categories()
    assert len(cat_summary) == len(categories)
    assert sum(c["count"] for c in cat_summary) == total_toolkits

    # Verify helper get_composio_toolkit_by_key
    assert get_composio_toolkit_by_key("slack") is not None
    assert get_composio_toolkit_by_key("github") is not None
    assert get_composio_toolkit_by_key("non_existent_key_xyz_123") is None

    # Verify helper get_composio_toolkits with pagination & search
    page, count = get_composio_toolkits(limit=10, offset=0)
    assert len(page) == 10
    assert count == total_toolkits

    page_search, count_search = get_composio_toolkits(search="slack", limit=10, offset=0)
    assert any("slack" in item["key"] or "slack" in item["name"].lower() for item in page_search)
    assert count_search >= 1


# ============================================================================
# 2. GET /v1/marketplace/apps Catalog, Counts, and Pagination
# ============================================================================
def test_marketplace_apps_counts_and_structure(client, viewer_token):
    """Verify GET /v1/marketplace/apps returns >= 1640 Composio, 6 FastMCP, and >= 1646 total."""
    resp = client.get("/v1/marketplace/apps", headers=auth_header(viewer_token))
    assert resp.status_code == 200
    data = resp.json()

    counts = data.get("counts", {})
    assert counts.get("composio", 0) >= 1640, f"Expected counts.composio >= 1640, got {counts.get('composio')}"
    assert counts.get("fastmcp", 0) == 6, f"Expected counts.fastmcp == 6, got {counts.get('fastmcp')}"
    assert counts.get("total", 0) >= 1646, f"Expected counts.total >= 1646, got {counts.get('total')}"
    assert counts["total"] == counts["composio"] + counts["fastmcp"]


def test_marketplace_apps_pagination(client, viewer_token):
    """Verify limit and offset pagination across the 1646+ connectors."""
    # First page: limit=24, offset=0
    resp1 = client.get("/v1/marketplace/apps?limit=24&offset=0", headers=auth_header(viewer_token))
    assert resp1.status_code == 200
    data1 = resp1.json()

    assert len(data1["apps"]) == 24
    pagination1 = data1.get("pagination", {})
    assert pagination1.get("limit") == 24
    assert pagination1.get("offset") == 0
    assert pagination1.get("has_more") is True
    assert pagination1.get("total") >= 1646

    keys_page1 = [a["key"] for a in data1["apps"]]
    assert len(set(keys_page1)) == 24

    # Second page: limit=24, offset=24
    resp2 = client.get("/v1/marketplace/apps?limit=24&offset=24", headers=auth_header(viewer_token))
    assert resp2.status_code == 200
    data2 = resp2.json()

    assert len(data2["apps"]) == 24
    pagination2 = data2.get("pagination", {})
    assert pagination2.get("limit") == 24
    assert pagination2.get("offset") == 24
    assert pagination2.get("has_more") is True

    keys_page2 = [a["key"] for a in data2["apps"]]
    assert len(set(keys_page2)) == 24

    # Ensure pages are distinct
    overlap = set(keys_page1).intersection(set(keys_page2))
    assert len(overlap) == 0, f"Unexpected page overlap: {overlap}"


def test_marketplace_apps_category_filtering(client, viewer_token):
    """Verify category filtering queries only matching toolkits."""
    resp_all = client.get("/v1/marketplace/apps?limit=1", headers=auth_header(viewer_token))
    assert resp_all.status_code == 200
    categories = resp_all.json().get("categories", [])
    assert len(categories) > 0, "Expected category facets in marketplace response"

    test_category = categories[0]["name"]
    expected_count = categories[0]["count"]

    resp_filtered = client.get(
        f"/v1/marketplace/apps?category={test_category}&limit=50",
        headers=auth_header(viewer_token),
    )
    assert resp_filtered.status_code == 200
    filtered_data = resp_filtered.json()

    for app_item in filtered_data["apps"]:
        assert app_item["category"].lower() == test_category.lower()

    if expected_count <= 50:
        assert len(filtered_data["apps"]) == expected_count
        assert filtered_data["pagination"]["has_more"] is False
    else:
        assert len(filtered_data["apps"]) == 50
        assert filtered_data["pagination"]["has_more"] is True


def test_marketplace_apps_search_filtering(client, viewer_token):
    """Verify keyword search returns relevant toolkits across the 1640+ catalog."""
    resp = client.get("/v1/marketplace/apps?search=github&limit=20", headers=auth_header(viewer_token))
    assert resp.status_code == 200
    data = resp.json()

    assert len(data["apps"]) >= 1
    found = any(a["key"] == "github" for a in data["apps"])
    assert found, "Expected 'github' in search results for 'github'"


def test_marketplace_apps_provider_filtering(client, viewer_token):
    """Verify provider filtering isolates Composio vs FastMCP connectors."""
    # FastMCP only
    resp_fastmcp = client.get("/v1/marketplace/apps?provider=fastmcp", headers=auth_header(viewer_token))
    assert resp_fastmcp.status_code == 200
    fastmcp_data = resp_fastmcp.json()
    assert len(fastmcp_data["apps"]) == 6
    assert all(a["provider"] == "fastmcp" for a in fastmcp_data["apps"])

    # Composio only
    resp_composio = client.get("/v1/marketplace/apps?provider=composio&limit=30", headers=auth_header(viewer_token))
    assert resp_composio.status_code == 200
    comp_data = resp_composio.json()
    assert len(comp_data["apps"]) == 30
    assert all(a["provider"] == "composio" for a in comp_data["apps"])


# ============================================================================
# 3. POST /v1/marketplace/connect Direct Connect & Redirect Link
# ============================================================================
def test_connect_composio_toolkit_returns_redirect_url(client, engineer_token):
    """Connecting a Composio toolkit returns status and redirect_url containing composio.dev."""
    test_keys = ["slack", "github", "linear"]
    for app_key in test_keys:
        resp = client.post(
            "/v1/marketplace/connect",
            headers=auth_header(engineer_token),
            json={"app_key": app_key, "entity_id": f"tenant-node-{app_key}"},
        )
        assert resp.status_code == 200, f"Connect failed for {app_key}: {resp.text}"
        data = resp.json()

        assert data.get("ok") is True or data.get("status") in ("connected", "pending_auth")
        # Verify redirect_url points to composio.dev
        redirect_url = data.get("redirect_url") or (data.get("connection") or {}).get("redirect_url")
        assert redirect_url is not None, f"Missing redirect_url for {app_key}"
        assert "composio.dev" in redirect_url, f"Expected composio.dev in redirect_url, got {redirect_url}"

        # Verify connection object
        conn = data.get("connection")
        assert conn is not None
        assert conn.get("status") in ("connected", "pending_auth")
        assert conn.get("entity_id") == f"tenant-node-{app_key}"

        # Verify tools are registered in /v1/tools
        tools_resp = client.get("/v1/tools", headers=auth_header(engineer_token))
        assert tools_resp.status_code == 200
        registered_tools = tools_resp.json()
        registered_names = {t["name"] for t in registered_tools}

        app_tools = data.get("registered_tools") or [f"{app_key}_{t}" for t in range(2)]
        for t_name in app_tools:
            if isinstance(t_name, str):
                assert t_name in registered_names, f"Tool {t_name} not found in /v1/tools"


# ============================================================================
# 4. POST /v1/marketplace/test/{app_key} Execution
# ============================================================================
def test_execute_connected_composio_action_from_1640_catalog(client, engineer_token):
    """Test action execution on connected Composio toolkit returns valid structured result."""
    # Connect toolkit
    app_key = "github"
    client.post(
        "/v1/marketplace/connect",
        headers=auth_header(engineer_token),
        json={"app_key": app_key},
    )

    # Test toolkit action
    test_resp = client.post(
        f"/v1/marketplace/test/{app_key}",
        headers=auth_header(engineer_token),
        json={"repo": "acme/repo", "title": "Test Issue from Marketplace"},
    )
    assert test_resp.status_code == 200, f"Test failed: {test_resp.text}"
    result_data = test_resp.json()

    assert result_data.get("ok") is True
    assert result_data.get("app_key") == app_key
    assert "result" in result_data

    action_result = result_data["result"]
    assert action_result.get("ok") is True
    assert action_result.get("provider") == "composio" or action_result.get("connector") == "composio"


def test_test_unconnected_app_returns_404(client, engineer_token):
    """Testing an unconnected toolkit returns HTTP 404."""
    resp = client.post("/v1/marketplace/test/zendesk", headers=auth_header(engineer_token))
    assert resp.status_code == 404


def test_test_nonexistent_app_returns_404(client, engineer_token):
    """Testing an unknown toolkit returns HTTP 404."""
    resp = client.post("/v1/marketplace/test/nonexistent_xyz_999", headers=auth_header(engineer_token))
    assert resp.status_code == 404


# ============================================================================
# 5. Disconnect Cleanup & Multi-Tenant Isolation
# ============================================================================
def test_disconnect_removes_connection_and_tools(client, engineer_token):
    """Disconnecting an integration removes the connection row and cleans up registered tools."""
    app_key = "slack"
    client.post("/v1/marketplace/connect", headers=auth_header(engineer_token), json={"app_key": app_key})

    # Verify connected
    tools_before = {t["name"] for t in client.get("/v1/tools", headers=auth_header(engineer_token)).json()}
    slack_tools = [t for t in tools_before if "slack" in t]
    assert len(slack_tools) >= 1

    # Disconnect
    del_resp = client.delete(f"/v1/marketplace/connections/{app_key}", headers=auth_header(engineer_token))
    assert del_resp.status_code == 200

    # Verify tools deregistered
    tools_after = {t["name"] for t in client.get("/v1/tools", headers=auth_header(engineer_token)).json()}
    for st in slack_tools:
        assert st not in tools_after, f"Tool {st} was not removed after disconnect"


def test_tenant_isolation_for_1640_toolkits(client, admin_token, tenant_b_admin_token):
    """A connected toolkit in Tenant A does not reflect as connected in Tenant B."""
    app_key = "linear"
    client.post("/v1/marketplace/connect", headers=auth_header(admin_token), json={"app_key": app_key})

    # Tenant A sees linear connected
    apps_a = client.get("/v1/marketplace/apps?search=linear", headers=auth_header(admin_token)).json()
    linear_a = next(a for a in apps_a["apps"] if a["key"] == app_key)
    assert linear_a["connected"] is True

    # Tenant B sees linear disconnected
    apps_b = client.get("/v1/marketplace/apps?search=linear", headers=auth_header(tenant_b_admin_token)).json()
    linear_b = next(a for a in apps_b["apps"] if a["key"] == app_key)
    assert linear_b["connected"] is False


def test_rbac_protection(client, viewer_token, approver_token):
    """Viewer and approver roles are blocked (403) from connecting or testing toolkits."""
    for token in (viewer_token, approver_token):
        c_resp = client.post(
            "/v1/marketplace/connect",
            headers=auth_header(token),
            json={"app_key": "github"},
        )
        assert c_resp.status_code == 403

        t_resp = client.post(
            "/v1/marketplace/test/github",
            headers=auth_header(token),
        )
        assert t_resp.status_code == 403

        d_resp = client.delete(
            "/v1/marketplace/connections/github",
            headers=auth_header(token),
        )
        assert d_resp.status_code == 403
