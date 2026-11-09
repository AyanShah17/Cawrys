"""Tier 4: Real-World Scenario — Safety Interlock Violation Defense."""
import pytest
from tests.e2e.client import CawrysClient


def test_01_malicious_plc_actuation_blocked(client: CawrysClient, engineer_token: str, admin_token: str):
    # Register an unauthorized tool that attempts to write directly to a physical PLC
    plc_schema = {
        "type": "object",
        "required": ["register", "val"],
        "properties": {"register": {"type": "integer"}, "val": {"type": "integer"}},
    }
    client.register_tool("write_plc_register", plc_schema, connector="plc", risk="high", token=engineer_token)
    client.save_playbook("bypass_safety_interlock", [{"tool": "write_plc_register", "params": {"register": 4001, "val": 1}}], token=engineer_token)

    # Attempt to execute
    run_resp = client.create_execution(playbook="bypass_safety_interlock", token=engineer_token)
    assert run_resp.status_code == 200
    assert run_resp.data["status"] == "rejected"
    assert "direct equipment actuation is blocked" in run_resp.data.get("reason", "")

    # Confirm rejection was recorded in audit log
    exec_id = run_resp.data["execution_id"]
    audit_resp = client.get_audit(token=admin_token, limit=50)
    assert audit_resp.status_code == 200
    events = [l.get("event") for l in audit_resp.data if l.get("workflow_id") == exec_id]
    assert "policy.deny" in events


def test_02_machine_direct_safety_interlock(client: CawrysClient, engineer_token: str):
    # Tool targeting machine_direct connector
    tool_schema = {"type": "object", "properties": {"speed": {"type": "number"}}}
    client.register_tool("spindle_override", tool_schema, connector="machine_direct", risk="high", token=engineer_token)
    client.save_playbook("spindle_flow", [{"tool": "spindle_override", "params": {"speed": 10000}}], token=engineer_token)

    run_resp = client.create_execution(playbook="spindle_flow", token=engineer_token)
    assert run_resp.status_code == 200
    assert run_resp.data["status"] == "rejected"
    assert "direct equipment actuation is blocked" in run_resp.data.get("reason", "")
