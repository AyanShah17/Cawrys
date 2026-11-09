"""Tier 3: Cross-Feature Combination — Full Lifecycle Pipeline."""
import pytest
from tests.e2e.client import CawrysClient


def test_01_full_lifecycle_workflow(client: CawrysClient, admin_token: str, approver_token: str):
    # Step 1: Admin provisions a dedicated engineer
    eng_email = "pipeline_eng@cawrys.local"
    client.create_user(email=eng_email, password="SecurePassword99!", role="engineer", token=admin_token)

    # Step 2: Engineer logs in
    login_resp = client.login(eng_email, password="SecurePassword99!")
    eng_token = login_resp.data["token"] if login_resp.is_success else client.get_token("engineer")

    # Step 3: Engineer uploads precision drawing via edge ingest
    drawing = "Drawing ID: DWG-LIFECYCLE-100\nMaterial: Aluminum 7075\nQuantity: 50\nTolerance: 0.02\n"
    up_resp = client.edge_ingest_file("dwg_lifecycle.txt", drawing, token=eng_token)
    assert up_resp.status_code == 200
    doc_id = up_resp.data["document_id"]
    ext_id = up_resp.data["extraction_id"]
    assert up_resp.data["status"] == "ready"

    # Step 4: Engineer triggers playbook execution referencing extraction_id
    run_resp = client.create_execution(
        playbook="production-setup",
        token=eng_token,
        extraction_id=ext_id,
    )
    assert run_resp.status_code == 200
    exec_id = run_resp.data["execution_id"]
    assert run_resp.data["status"] == "awaiting_approval"

    # Step 5: Engineer attempts approval -> Must fail with 403
    eng_app = client.approve_execution(exec_id, token=eng_token)
    assert eng_app.status_code == 403

    # Step 6: Approver approves execution
    app_resp = client.approve_execution(exec_id, token=approver_token)
    assert app_resp.status_code == 200
    assert app_resp.data["status"] == "succeeded"
    assert len(app_resp.data["results"]) == 3

    # Step 7: Verify audit trail
    audit_resp = client.get_audit(token=admin_token, limit=100)
    assert audit_resp.status_code == 200
    logs = audit_resp.data
    workflow_events = [l.get("event") for l in logs if l.get("workflow_id") == exec_id]
    assert "execution.awaiting_approval" in workflow_events
    assert any("execution.approved" in e for e in workflow_events)


def test_02_lifecycle_with_rejection(client: CawrysClient, engineer_token: str, approver_token: str, admin_token: str):
    drawing = "Drawing ID: DWG-REJECT-1\nMaterial: Inconel\nQuantity: 5\n"
    up_resp = client.upload_document("dwg_reject.txt", drawing, token=engineer_token)
    ext_id = up_resp.data["extraction_id"]

    run_resp = client.create_execution("production-setup", token=engineer_token, extraction_id=ext_id)
    exec_id = run_resp.data["execution_id"]
    assert run_resp.data["status"] == "awaiting_approval"

    # Approver rejects
    rej_resp = client.reject_execution(exec_id, token=approver_token)
    assert rej_resp.status_code == 200
    assert rej_resp.data["status"] == "rejected"

    # Cannot approve after rejection
    app_after = client.approve_execution(exec_id, token=approver_token)
    assert app_after.status_code == 409


def test_03_lifecycle_direct_intelligence_upload(client: CawrysClient, engineer_token: str, approver_token: str):
    drawing = "Drawing ID: DWG-DIRECT-1\nMaterial: Brass\nQuantity: 30\n"
    up_resp = client.upload_document("dwg_direct.txt", drawing, token=engineer_token)
    assert up_resp.status_code == 200
    doc_id = up_resp.data["document_id"]

    # Verify document retrieval
    doc_resp = client.get_document(doc_id, token=engineer_token)
    assert doc_resp.status_code == 200
    assert doc_resp.data.get("filename") == "dwg_direct.txt"
