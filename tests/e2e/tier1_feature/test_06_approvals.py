"""Tier 1: Feature Coverage — Approvals & Resumption Workflow."""
import pytest
from tests.e2e.client import CawrysClient


def _create_pending_run(client: CawrysClient, engineer_token: str) -> str:
    resp = client.create_execution(
        playbook="production-setup",
        token=engineer_token,
        inputs={"material": "Aluminum 6061", "drawing_id": "DWG-1042", "quantity": 25},
    )
    assert resp.status_code == 200
    assert resp.data.get("status") == "awaiting_approval"
    return resp.data["execution_id"]


def test_01_approver_can_approve(client: CawrysClient, engineer_token: str, approver_token: str):
    exec_id = _create_pending_run(client, engineer_token)
    resp = client.approve_execution(exec_id, token=approver_token)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.data}"
    assert resp.data.get("status") == "succeeded"


def test_02_admin_can_approve(client: CawrysClient, engineer_token: str, admin_token: str):
    exec_id = _create_pending_run(client, engineer_token)
    resp = client.approve_execution(exec_id, token=admin_token)
    assert resp.status_code == 200
    assert resp.data.get("status") == "succeeded"


def test_03_engineer_cannot_approve(client: CawrysClient, engineer_token: str):
    exec_id = _create_pending_run(client, engineer_token)
    resp = client.approve_execution(exec_id, token=engineer_token)
    assert resp.status_code == 403, f"Expected 403 Forbidden, got {resp.status_code}"


def test_04_viewer_cannot_approve(client: CawrysClient, engineer_token: str, viewer_token: str):
    exec_id = _create_pending_run(client, engineer_token)
    resp = client.approve_execution(exec_id, token=viewer_token)
    assert resp.status_code == 403, f"Expected 403 Forbidden, got {resp.status_code}"


def test_05_approver_can_reject(client: CawrysClient, engineer_token: str, approver_token: str):
    exec_id = _create_pending_run(client, engineer_token)
    resp = client.reject_execution(exec_id, token=approver_token)
    assert resp.status_code == 200
    assert resp.data.get("status") == "rejected"


def test_06_double_approval_conflict(client: CawrysClient, engineer_token: str, approver_token: str):
    exec_id = _create_pending_run(client, engineer_token)
    # First approval succeeds
    ok_resp = client.approve_execution(exec_id, token=approver_token)
    assert ok_resp.status_code == 200
    # Second approval must conflict (HTTP 409)
    dup_resp = client.approve_execution(exec_id, token=approver_token)
    assert dup_resp.status_code == 409, f"Expected 409 Conflict, got {dup_resp.status_code}"


def test_07_step_execution_idempotency(client: CawrysClient, engineer_token: str, approver_token: str):
    exec_id = _create_pending_run(client, engineer_token)
    ok_resp = client.approve_execution(exec_id, token=approver_token)
    assert ok_resp.status_code == 200
    results = ok_resp.data.get("results", [])
    # Exactly 3 steps executed (0, 1, 2)
    assert len(results) == 3
    steps = [r.get("step") for r in results]
    assert steps == [0, 1, 2]
