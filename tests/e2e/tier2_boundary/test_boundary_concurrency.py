"""Tier 2: Boundary & Corner Cases — Concurrency, Conflict & Schema Validation."""
import pytest
from tests.e2e.client import CawrysClient


def test_01_double_approval_conflict(client: CawrysClient, engineer_token: str, approver_token: str):
    resp = client.create_execution(
        playbook="production-setup",
        token=engineer_token,
        inputs={"material": "Steel", "drawing_id": "DWG-CONC-1", "quantity": 10},
    )
    exec_id = resp.data["execution_id"]

    # First approval succeeds
    r1 = client.approve_execution(exec_id, token=approver_token)
    assert r1.status_code == 200

    # Second approval fails with 409 Conflict
    r2 = client.approve_execution(exec_id, token=approver_token)
    assert r2.status_code == 409


def test_02_double_reject_conflict(client: CawrysClient, engineer_token: str, approver_token: str):
    resp = client.create_execution(
        playbook="production-setup",
        token=engineer_token,
        inputs={"material": "Steel", "drawing_id": "DWG-CONC-2", "quantity": 10},
    )
    exec_id = resp.data["execution_id"]

    # First reject succeeds
    r1 = client.reject_execution(exec_id, token=approver_token)
    assert r1.status_code == 200

    # Second reject fails with 409 Conflict
    r2 = client.reject_execution(exec_id, token=approver_token)
    assert r2.status_code == 409


def test_03_approve_non_awaiting_execution(client: CawrysClient, approver_token: str):
    # Non-existent or already completed execution ID
    fake_id = "00000000-0000-0000-0000-999999999999"
    resp = client.approve_execution(fake_id, token=approver_token)
    assert resp.status_code == 409


def test_04_tool_registration_invalid_schema(client: CawrysClient, engineer_token: str):
    # Invalid schema type (not a valid Draft2020-12 schema)
    invalid_schema = {"type": "not_a_valid_json_type"}
    resp = client.register_tool("bad_tool", invalid_schema, token=engineer_token)
    assert resp.status_code in (400, 422)
