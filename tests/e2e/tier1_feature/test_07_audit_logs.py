"""Tier 1: Feature Coverage — Actor-Attributed Audit Trail."""
import pytest
from tests.e2e.client import CawrysClient


def test_01_upload_audit_events(client: CawrysClient, engineer_token: str, admin_token: str):
    content = "Drawing ID: DWG-AUDIT-1\nMaterial: Copper\nQuantity: 15\n"
    up_resp = client.upload_document("audit_doc.txt", content, token=engineer_token)
    assert up_resp.status_code == 200
    doc_id = up_resp.data["document_id"]

    audit_resp = client.get_audit(token=admin_token, limit=100)
    assert audit_resp.status_code == 200
    logs = audit_resp.data
    events = [l.get("event") for l in logs if l.get("workflow_id") == doc_id]
    assert "document.received" in events
    assert "document.processed" in events


def test_02_execution_lifecycle_audit(client: CawrysClient, engineer_token: str, approver_token: str, admin_token: str):
    run_resp = client.create_execution(
        playbook="production-setup",
        token=engineer_token,
        inputs={"material": "Aluminum", "drawing_id": "DWG-1042", "quantity": 10},
    )
    exec_id = run_resp.data["execution_id"]
    client.approve_execution(exec_id, token=approver_token)

    audit_resp = client.get_audit(token=admin_token, limit=100)
    logs = audit_resp.data
    events = [l.get("event") for l in logs if l.get("workflow_id") == exec_id]
    assert "execution.awaiting_approval" in events
    assert any("execution.approved" in e for e in events)


def test_03_policy_decision_audit(client: CawrysClient, engineer_token: str, admin_token: str):
    run_resp = client.create_execution(
        playbook="production-setup",
        token=engineer_token,
        inputs={"material": "Aluminum", "drawing_id": "DWG-1042", "quantity": 10},
    )
    exec_id = run_resp.data["execution_id"]

    audit_resp = client.get_audit(token=admin_token, limit=100)
    logs = audit_resp.data
    events = [l.get("event") for l in logs if l.get("workflow_id") == exec_id]
    assert "policy.allow" in events
    assert "policy.needs_approval" in events


def test_04_actor_attribution_integrity(client: CawrysClient, engineer_token: str, approver_token: str, admin_token: str):
    run_resp = client.create_execution(
        playbook="production-setup",
        token=engineer_token,
        inputs={"material": "Aluminum", "drawing_id": "DWG-1042", "quantity": 10},
    )
    exec_id = run_resp.data["execution_id"]
    client.approve_execution(exec_id, token=approver_token)

    audit_resp = client.get_audit(token=admin_token, limit=100)
    logs = audit_resp.data
    approval_log = next(
        (l for l in logs if l.get("workflow_id") == exec_id and "execution.approved" in l.get("event", "")),
        None,
    )
    assert approval_log is not None
    assert approval_log.get("actor") == "approver@cawrys.local"


def test_05_failed_login_audit(client: CawrysClient, admin_token: str):
    client.login("engineer", password="wrong_password_test")
    audit_resp = client.get_audit(token=admin_token, limit=50)
    logs = audit_resp.data
    failed_login = next(
        (l for l in logs if l.get("event") == "auth.login_failed" and l.get("detail", {}).get("email") == "engineer@cawrys.local"),
        None,
    )
    assert failed_login is not None


def test_06_audit_chronological_ordering(client: CawrysClient, admin_token: str):
    audit_resp = client.get_audit(token=admin_token, limit=50)
    assert audit_resp.status_code == 200
    logs = audit_resp.data
    if len(logs) > 1:
        # Check monotonic non-increasing timestamps or descending IDs
        for i in range(len(logs) - 1):
            assert logs[i].get("id", 0) >= logs[i + 1].get("id", 0) or logs[i].get("created_at") >= logs[i + 1].get("created_at")
