"""Tier 1: Feature Coverage — Execution Policies & Risk Gating."""
import pytest
from tests.e2e.client import CawrysClient


def test_01_low_risk_tool_auto_executes(client: CawrysClient, engineer_token: str):
    # Register a low-risk tool and playbook
    tool_schema = {"type": "object", "properties": {"msg": {"type": "string"}}}
    client.register_tool("echo_low", tool_schema, connector="log", risk="low", token=engineer_token)
    client.save_playbook("low_risk_flow", [{"tool": "echo_low", "params": {"msg": "hello"}}], token=engineer_token)

    resp = client.create_execution(playbook="low_risk_flow", token=engineer_token)
    assert resp.status_code == 200
    assert resp.data.get("status") == "succeeded"
    assert len(resp.data.get("results", [])) == 1


def test_02_medium_risk_tool_pauses_for_approval(client: CawrysClient, engineer_token: str):
    # production-setup has step 0 (low), step 1 (medium: schedule_production), step 2 (low)
    resp = client.create_execution(
        playbook="production-setup",
        token=engineer_token,
        inputs={"material": "Aluminum", "drawing_id": "DWG-1", "quantity": 10},
    )
    assert resp.status_code == 200
    assert resp.data.get("status") == "awaiting_approval"
    # Step 0 should have executed
    results = resp.data.get("results", [])
    assert len(results) == 1
    assert results[0].get("tool") == "erp_lookup_inventory"


def test_03_high_risk_tool_requires_approval(client: CawrysClient, engineer_token: str):
    tool_schema = {"type": "object", "properties": {"amount": {"type": "number"}}}
    client.register_tool("wire_transfer", tool_schema, connector="log", risk="high", token=engineer_token)
    client.save_playbook("high_risk_flow", [{"tool": "wire_transfer", "params": {"amount": 50000}}], token=engineer_token)

    resp = client.create_execution(playbook="high_risk_flow", token=engineer_token)
    assert resp.status_code == 200
    assert resp.data.get("status") == "awaiting_approval"


def test_04_forbidden_connectors_denied(client: CawrysClient, engineer_token: str):
    tool_schema = {"type": "object", "properties": {"cmd": {"type": "string"}}}
    client.register_tool("plc_direct_write", tool_schema, connector="plc", risk="high", token=engineer_token)
    client.save_playbook("plc_flow", [{"tool": "plc_direct_write", "params": {"cmd": "START_MOTOR"}}], token=engineer_token)

    resp = client.create_execution(playbook="plc_flow", token=engineer_token)
    assert resp.status_code == 200
    assert resp.data.get("status") == "rejected"
    assert "direct equipment actuation is blocked" in resp.data.get("reason", "")


def test_05_viewer_execution_denied(client: CawrysClient, viewer_token: str):
    resp = client.create_execution(
        playbook="production-setup",
        token=viewer_token,
        inputs={"material": "Aluminum", "drawing_id": "DWG-1", "quantity": 10},
    )
    assert resp.status_code == 200
    assert resp.data.get("status") == "rejected"
    assert "viewer role cannot execute" in resp.data.get("reason", "")


def test_06_missing_playbook_not_found(client: CawrysClient, engineer_token: str):
    resp = client.create_execution(playbook="non_existent_playbook_xyz", token=engineer_token)
    assert resp.status_code == 404
