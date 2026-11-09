"""Tier 3: Cross-Feature Combination — Multi-Tenant Strict Data Isolation."""
import pytest
from tests.e2e.client import CawrysClient, make_custom_token


TENANT_B_ID = "00000000-0000-0000-0000-000000000002"


@pytest.fixture
def tenant_b_token() -> str:
    return make_custom_token(
        user_id="00000000-0000-0000-0000-000000000099",
        tenant_id=TENANT_B_ID,
        role="engineer",
        email="engineer@tenant-b.local",
    )


def test_01_cross_tenant_document_isolation(client: CawrysClient, engineer_token: str, tenant_b_token: str):
    # Tenant A uploads a document
    drawing = "Drawing ID: DWG-TENANT-A\nMaterial: Titanium\nQuantity: 12\n"
    up_resp = client.upload_document("tenant_a_doc.txt", drawing, token=engineer_token)
    assert up_resp.status_code == 200
    doc_id = up_resp.data["document_id"]

    # Tenant B tries to read Tenant A's document -> Must return 404
    read_resp = client.get_document(doc_id, token=tenant_b_token)
    assert read_resp.status_code == 404


def test_02_cross_tenant_execution_isolation(client: CawrysClient, engineer_token: str, tenant_b_token: str):
    # Tenant A creates an execution
    run_resp = client.create_execution(
        playbook="production-setup",
        token=engineer_token,
        inputs={"material": "Titanium", "drawing_id": "DWG-TENANT-A", "quantity": 12},
    )
    exec_id = run_resp.data["execution_id"]

    # Tenant B lists executions -> Should not contain Tenant A's execution
    list_resp = client.list_executions(token=tenant_b_token)
    assert list_resp.status_code == 200
    b_exec_ids = [ex.get("id") for ex in list_resp.data]
    assert exec_id not in b_exec_ids

    # Tenant B attempts to approve Tenant A's execution -> 403 or 409
    app_resp = client.approve_execution(exec_id, token=tenant_b_token)
    assert app_resp.status_code in (403, 409)


def test_03_cross_tenant_audit_isolation(client: CawrysClient, admin_token: str, tenant_b_token: str):
    # Tenant B queries audit logs -> Should be empty or contain only Tenant B events
    b_audit_resp = client.get_audit(token=tenant_b_token, limit=100)
    assert b_audit_resp.status_code == 200
    for entry in b_audit_resp.data:
        assert entry.get("tenant_id") == TENANT_B_ID
