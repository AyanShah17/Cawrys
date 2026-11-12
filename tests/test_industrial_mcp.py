"""Automated Test Suite for Industrial FastMCP Servers & Marketplace Integration.

Covers:
1. Discovery of all 6 Industrial FastMCP servers via GET /v1/mcp/servers:
   - sap_s4hana, siemens_xcelerator, rockwell_factorytalk, dassault_3dexperience, ptc_windchill, oracle_scm.
2. SAP S/4HANA module and tool coverage across MM, PP, SD, QM, PM/EAM, FI/CO, EWM.
3. Siemens Xcelerator module and tool coverage across Teamcenter, Opcenter, NX, Simcenter, MindSphere, Tecnomatix.
4. Direct FastMCP execution via POST /v1/mcp/servers/{server_key}/call for SAP and Siemens.
5. Direct FastMCP execution across Rockwell, Dassault, PTC, and Oracle servers.
6. Marketplace connection via POST /v1/marketplace/connect and tool auto-registration in /v1/tools.
7. Health/test verification via POST /v1/marketplace/test/{app_key}.
8. End-to-end playbook execution invoking FastMCP industrial tools through FastMCPConnector.
9. Error handling for unknown servers and unregistered tools.
"""
import os
import pytest
from fastapi.testclient import TestClient

os.environ["MOCK_AI"] = "1"
os.environ["SQLITE_PATH"] = "/tmp/cawrys_test_industrial_mcp.db"
os.environ["AUTH_SECRET"] = "0123456789012345678901234567890123456789012345678901234567890123"

from services.execution.app.auth import make_token
from services.execution.app.main import app
from services.execution.app.sqlite_adapter import get_connection

TENANT_ID = "00000000-0000-0000-0000-000000000001"
TENANT_B_ID = "00000000-0000-0000-0000-000000000002"

EXPECTED_SERVERS = {
    "sap_s4hana",
    "siemens_xcelerator",
    "rockwell_factorytalk",
    "dassault_3dexperience",
    "ptc_windchill",
    "oracle_scm",
}


@pytest.fixture(autouse=True)
def setup_db():
    """Ensure clean database state before each test run."""
    with get_connection() as c:
        c.execute("INSERT OR IGNORE INTO tenants (id, name) VALUES (%s, %s)", (TENANT_ID, "Demo Tenant"))
        c.execute("INSERT OR IGNORE INTO tenants (id, name) VALUES (%s, %s)", (TENANT_B_ID, "Second Tenant"))
        c.execute("DELETE FROM marketplace_connections")
        c.execute("DELETE FROM tools WHERE connector in ('fastmcp', 'composio')")
        c.execute("DELETE FROM executions")
        c.execute("DELETE FROM playbooks WHERE name like 'sap-%' or name like 'siemens-%'")
        c.commit()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def engineer_token():
    return make_token("eng-1", TENANT_ID, "engineer", "engineer@cawrys.local")


@pytest.fixture
def admin_token():
    return make_token("admin-1", TENANT_ID, "admin", "admin@cawrys.local")


@pytest.fixture
def viewer_token():
    return make_token("view-1", TENANT_ID, "viewer", "viewer@cawrys.local")


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_list_all_6_industrial_mcp_servers(client):
    """GET /v1/mcp/servers returns all 6 industrial FastMCP servers with modules and tool definitions."""
    resp = client.get("/v1/mcp/servers")
    assert resp.status_code == 200
    servers = resp.json()
    assert isinstance(servers, list)
    assert len(servers) == 6

    server_keys = {s["key"] for s in servers}
    assert server_keys == EXPECTED_SERVERS

    for s in servers:
        assert s["provider"] == "fastmcp"
        assert len(s["modules"]) >= 2
        assert len(s["tools"]) >= 4
        assert s["tool_count"] == len(s["tools"])
        assert s["default_action"] is not None
        assert s["docs_url"].startswith("http")


def test_sap_s4hana_tools_across_modules(client):
    """GET /v1/mcp/servers/sap_s4hana/tools returns SAP tools across MM, PP, SD, QM, PM, FI/CO, EWM modules."""
    resp = client.get("/v1/mcp/servers/sap_s4hana/tools")
    assert resp.status_code == 200
    tools = resp.json()
    assert len(tools) >= 13

    tool_names = {t["name"] for t in tools}

    # MM (Materials Management)
    assert "sap_mm_get_material_master" in tool_names
    assert "sap_mm_create_purchase_order" in tool_names
    assert "sap_mm_check_stock_overview" in tool_names

    # PP (Production Planning)
    assert "sap_pp_create_production_order" in tool_names
    assert "sap_pp_explode_bom" in tool_names
    assert "sap_pp_confirm_operation" in tool_names

    # SD (Sales & Distribution)
    assert "sap_sd_create_sales_order" in tool_names
    assert "sap_sd_check_atp_delivery" in tool_names

    # QM (Quality Management)
    assert "sap_qm_create_inspection_lot" in tool_names
    assert "sap_qm_record_usage_decision" in tool_names

    # PM/EAM (Plant Maintenance)
    assert "sap_pm_create_maintenance_notification" in tool_names
    assert "sap_pm_create_work_order" in tool_names

    # FI/CO (Finance & Controlling)
    assert "sap_fico_post_cost_allocation" in tool_names
    assert "sap_fico_get_production_variance" in tool_names

    # EWM (Extended Warehouse Management)
    assert "sap_ewm_create_warehouse_task" in tool_names

    # Verify tool metadata structure
    for t in tools:
        assert t["endpoint"].startswith("/sap/opu/odata/sap/")
        assert t["connector"] == "fastmcp"
        assert t["input_schema"]["type"] == "object"
        assert len(t["input_schema"].get("properties", {})) >= 1


def test_siemens_xcelerator_tools_across_modules(client):
    """GET /v1/mcp/servers/siemens_xcelerator/tools returns Siemens tools across Teamcenter, Opcenter, NX, Simcenter, MindSphere, Tecnomatix."""
    resp = client.get("/v1/mcp/servers/siemens_xcelerator/tools")
    assert resp.status_code == 200
    tools = resp.json()
    assert len(tools) >= 11

    tool_names = {t["name"] for t in tools}

    # Teamcenter PLM
    assert "siemens_tc_get_item_revision" in tool_names
    assert "siemens_tc_create_ecn" in tool_names
    assert "siemens_tc_get_ebom" in tool_names

    # Opcenter MES
    assert "siemens_opcenter_dispatch_work_order" in tool_names
    assert "siemens_opcenter_log_nonconformance" in tool_names
    assert "siemens_opcenter_get_oee" in tool_names

    # NX & Simcenter CAD/CAE
    assert "siemens_nx_extract_pmi_tolerances" in tool_names
    assert "siemens_simcenter_run_thermal_stress_check" in tool_names

    # MindSphere / Industrial Edge IIoT
    assert "siemens_edge_read_plc_tags" in tool_names
    assert "siemens_mindsphere_query_timeseries" in tool_names

    # Tecnomatix
    assert "siemens_tecnomatix_validate_bop_routing" in tool_names

    for t in tools:
        assert t["connector"] == "fastmcp"
        assert t["input_schema"]["type"] == "object"
        assert t["module"] is not None


def test_direct_execution_sap_and_siemens(client):
    """POST /v1/mcp/servers/{server_key}/call executes tools and returns structured results."""
    # Execute SAP MM tool
    sap_call = client.post(
        "/v1/mcp/servers/sap_s4hana/call",
        json={
            "action": "sap_mm_get_material_master",
            "payload": {"material_id": "MAT-TITANIUM-09"},
        },
    )
    assert sap_call.status_code == 200
    sap_res = sap_call.json()
    assert sap_res["ok"] is True
    assert sap_res["provider"] == "fastmcp"
    assert sap_res["server"] == "sap_s4hana"
    assert sap_res["tool"] == "sap_mm_get_material_master"
    assert "data" in sap_res or "result" in sap_res

    # Execute SAP PP tool
    sap_pp_call = client.post(
        "/v1/mcp/servers/sap_s4hana/call",
        json={
            "name": "sap_pp_create_production_order",
            "arguments": {"material": "MAT-TITANIUM-09", "quantity": 100, "plant": "1000"},
        },
    )
    assert sap_pp_call.status_code == 200
    pp_res = sap_pp_call.json()
    assert pp_res["ok"] is True
    assert pp_res["tool"] == "sap_pp_create_production_order"

    # Execute Siemens Teamcenter tool
    siemens_call = client.post(
        "/v1/mcp/servers/siemens_xcelerator/call",
        json={
            "action": "siemens_tc_get_item_revision",
            "payload": {"item_id": "NX-BRACKET-55"},
        },
    )
    assert siemens_call.status_code == 200
    siemens_res = siemens_call.json()
    assert siemens_res["ok"] is True
    assert siemens_res["provider"] == "fastmcp"
    assert siemens_res["server"] == "siemens_xcelerator"
    assert siemens_res["tool"] == "siemens_tc_get_item_revision"
    assert "data" in siemens_res or "result" in siemens_res

    # Execute Siemens Opcenter tool
    opcenter_call = client.post(
        "/v1/mcp/servers/siemens_xcelerator/call",
        json={
            "name": "siemens_opcenter_dispatch_work_order",
            "arguments": {"work_order_id": "WO-9912", "work_center": "CNC-04", "quantity": 25},
        },
    )
    assert opcenter_call.status_code == 200
    assert opcenter_call.json()["ok"] is True


def test_direct_execution_other_industrial_servers(client):
    """POST /v1/mcp/servers/{server_key}/call executes tools across Rockwell, Dassault, PTC, Oracle."""
    # Rockwell
    rk_call = client.post(
        "/v1/mcp/servers/rockwell_factorytalk/call",
        json={"name": "rockwell_ft_dispatch_batch", "payload": {"batch_id": "BATCH-100", "recipe": "RCP-01"}},
    )
    assert rk_call.status_code == 200
    assert rk_call.json()["ok"] is True
    assert rk_call.json()["server"] == "rockwell_factorytalk"

    # Dassault
    ds_call = client.post(
        "/v1/mcp/servers/dassault_3dexperience/call",
        json={"name": "dassault_enovia_get_engineering_bom", "payload": {"part_number": "DS-ASM-10"}},
    )
    assert ds_call.status_code == 200
    assert ds_call.json()["ok"] is True
    assert ds_call.json()["server"] == "dassault_3dexperience"

    # PTC
    ptc_call = client.post(
        "/v1/mcp/servers/ptc_windchill/call",
        json={"name": "ptc_windchill_get_part_structure", "payload": {"part_id": "PTC-PART-01"}},
    )
    assert ptc_call.status_code == 200
    assert ptc_call.json()["ok"] is True
    assert ptc_call.json()["server"] == "ptc_windchill"

    # Oracle SCM
    ora_call = client.post(
        "/v1/mcp/servers/oracle_scm/call",
        json={"name": "oracle_scm_create_work_order", "payload": {"item_number": "ORA-ITEM-99", "quantity": 50}},
    )
    assert ora_call.status_code == 200
    assert ora_call.json()["ok"] is True
    assert ora_call.json()["server"] == "oracle_scm"


def test_connect_sap_and_siemens_via_marketplace(client, engineer_token):
    """Connecting sap_s4hana and siemens_xcelerator registers their tools in /v1/tools and test succeeds."""
    headers = auth_header(engineer_token)

    # Connect SAP S/4HANA
    sap_conn = client.post(
        "/v1/marketplace/connect",
        headers=headers,
        json={"app_key": "sap_s4hana", "auth_mode": "fastmcp", "entity_id": "plant-walldorf"},
    )
    assert sap_conn.status_code == 200
    sap_data = sap_conn.json()
    assert sap_data["ok"] is True
    assert sap_data["app_key"] == "sap_s4hana"
    assert "sap_mm_get_material_master" in sap_data["registered_tools"]
    assert "sap_pp_create_production_order" in sap_data["registered_tools"]

    # Test SAP S/4HANA connection
    sap_test = client.post("/v1/marketplace/test/sap_s4hana", headers=headers)
    assert sap_test.status_code == 200
    assert sap_test.json()["ok"] is True

    # Connect Siemens Xcelerator
    siemens_conn = client.post(
        "/v1/marketplace/connect",
        headers=headers,
        json={"app_key": "siemens_xcelerator", "auth_mode": "fastmcp", "entity_id": "plant-munich"},
    )
    assert siemens_conn.status_code == 200
    siemens_data = siemens_conn.json()
    assert siemens_data["ok"] is True
    assert siemens_data["app_key"] == "siemens_xcelerator"
    assert "siemens_tc_get_item_revision" in siemens_data["registered_tools"]
    assert "siemens_opcenter_dispatch_work_order" in siemens_data["registered_tools"]

    # Test Siemens Xcelerator connection
    siemens_test = client.post("/v1/marketplace/test/siemens_xcelerator", headers=headers)
    assert siemens_test.status_code == 200
    assert siemens_test.json()["ok"] is True

    # Verify tools registered in tenant's /v1/tools
    tenant_tools = client.get("/v1/tools", headers=headers).json()
    registered_names = {t["name"] for t in tenant_tools}
    assert "sap_mm_get_material_master" in registered_names
    assert "sap_pp_create_production_order" in registered_names
    assert "siemens_tc_get_item_revision" in registered_names
    assert "siemens_opcenter_dispatch_work_order" in registered_names

    # Check connector designation
    sap_tool_entry = next(t for t in tenant_tools if t["name"] == "sap_mm_get_material_master")
    assert sap_tool_entry["connector"] in ("fastmcp", "composio")


def test_playbook_execution_with_industrial_mcp(client, engineer_token):
    """Playbook successfully invokes connected FastMCP industrial tools."""
    headers = auth_header(engineer_token)

    # Connect SAP
    client.post("/v1/marketplace/connect", headers=headers, json={"app_key": "sap_s4hana"})

    # Create playbook with SAP tool
    pb_resp = client.post(
        "/v1/playbooks",
        headers=headers,
        json={
            "name": "sap-part-lookup-flow",
            "steps": [
                {
                    "tool": "sap_mm_get_material_master",
                    "params": {"material_id": "$inputs.material_id"},
                }
            ],
        },
    )
    assert pb_resp.status_code == 200

    # Run playbook
    run_resp = client.post(
        "/v1/executions",
        headers=headers,
        json={"playbook": "sap-part-lookup-flow", "inputs": {"material_id": "MAT-TITANIUM-09"}},
    )
    assert run_resp.status_code == 200
    run_data = run_resp.json()
    assert run_data["status"] == "succeeded"
    assert len(run_data["results"]) == 1
    step_res = run_data["results"][0]
    assert step_res["tool"] == "sap_mm_get_material_master"
    assert step_res["result"]["ok"] is True
    assert step_res["result"]["server"] == "sap_s4hana"


def test_mcp_error_handling(client):
    """Unknown servers return 404, unknown tools return 400."""
    # Unknown server tool listing
    resp_unknown_tools = client.get("/v1/mcp/servers/non_existent_server/tools")
    assert resp_unknown_tools.status_code == 404

    # Unknown server call
    resp_unknown_call = client.post(
        "/v1/mcp/servers/non_existent_server/call",
        json={"name": "any_tool"},
    )
    assert resp_unknown_call.status_code == 404

    # Known server with non-existent tool
    resp_unknown_tool_call = client.post(
        "/v1/mcp/servers/sap_s4hana/call",
        json={"name": "sap_completely_invalid_tool_name"},
    )
    assert resp_unknown_tool_call.status_code == 400
