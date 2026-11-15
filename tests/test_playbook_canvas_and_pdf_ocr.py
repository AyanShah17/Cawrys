"""Tests for Playbook Execution Pipeline Canvas AI APIs and Scanned PDF OCR / Reprocessing."""
import json
import os
import re
import uuid
import pytest
from fastapi.testclient import TestClient

os.environ["MOCK_AI"] = "1"
os.environ["SQLITE_PATH"] = "/tmp/cawrys_test_canvas_ocr.db"
os.environ["AUTH_SECRET"] = "0123456789012345678901234567890123456789012345678901234567890123"
os.environ["LOCAL_STORAGE_DIR"] = "/tmp/cawrys_test_canvas_files"

from services.execution.app.auth import make_token
from services.execution.app.chat_routes import _get_documents_by_ids, _init_chat_tables
from services.execution.app.main import app as exec_app
from services.execution.app.sqlite_adapter import get_connection
from services.intelligence.app import mock as intel_mock, storage as intel_storage, validate as intel_validate
from services.intelligence.app.main import app as intel_app

TENANT_ID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture(autouse=True)
def clean_db():
    _init_chat_tables()
    with get_connection() as c:
        c.execute("INSERT OR IGNORE INTO tenants (id, name) VALUES (%s, %s)", (TENANT_ID, "Demo Tenant"))
        c.execute("DELETE FROM chat_messages")
        c.execute("DELETE FROM executions")
        c.execute("DELETE FROM playbooks")
        c.execute("DELETE FROM tools")
        c.execute("DELETE FROM extractions")
        c.execute("DELETE FROM documents")
        c.commit()


def _auth_headers(role: str = "engineer"):
    token = make_token(str(uuid.uuid4()), TENANT_ID, role, f"{role}@cawrys.local")
    return {"Authorization": f"Bearer {token}"}


def test_playbook_put_delete_and_ai_editing_flow():
    client = TestClient(exec_app)
    headers = _auth_headers("engineer")

    # 1. Seed default playbooks
    r_list = client.get("/v1/playbooks", headers=headers)
    assert r_list.status_code == 200
    pbs = r_list.json()
    assert any(p["name"] == "production-setup" for p in pbs)

    # 2. AI: Add step before schedule_production
    r_add = client.post(
        "/v1/playbooks/ai",
        headers=headers,
        json={"playbook_name": "production-setup", "prompt": "Add quality_check step before schedule_production"},
    )
    assert r_add.status_code == 200, r_add.text
    d_add = r_add.json()
    assert d_add["ok"] is True
    assert d_add["action"] == "step_added"
    tools_seq = [s["tool"] for s in d_add["playbook"]["steps"]]
    assert tools_seq == ["erp_lookup_inventory", "quality_check", "schedule_production", "notify_team"]

    # 3. AI: Update parameter
    r_upd = client.post(
        "/v1/playbooks/ai",
        headers=headers,
        json={"playbook_name": "production-setup", "prompt": "Set schedule_production quantity to 250"},
    )
    assert r_upd.status_code == 200
    steps_upd = r_upd.json()["playbook"]["steps"]
    sched_step = next(s for s in steps_upd if s["tool"] == "schedule_production")
    assert sched_step["params"]["quantity"] == 250

    # 4. AI: Delete step
    r_del = client.post(
        "/v1/playbooks/ai",
        headers=headers,
        json={"playbook_name": "production-setup", "prompt": "Remove last step"},
    )
    assert r_del.status_code == 200
    assert [s["tool"] for s in r_del.json()["playbook"]["steps"]] == [
        "erp_lookup_inventory",
        "quality_check",
        "schedule_production",
    ]

    # 5. AI: Create playbook with custom tools (auto-registered)
    r_create = client.post(
        "/v1/playbooks/ai",
        headers=headers,
        json={"prompt": "Create a playbook called quality-gate with cmm_inspect, log_defect, and notify_team"},
    )
    assert r_create.status_code == 200
    created_pb = r_create.json()["playbook"]
    assert created_pb["name"] == "quality-gate"
    assert [s["tool"] for s in created_pb["steps"]] == ["cmm_inspect", "log_defect", "notify_team"]

    # Verify auto-registered tools allow immediate execution (or approval gate)
    r_exec = client.post(
        "/v1/executions",
        headers=headers,
        json={"playbook": "quality-gate", "inputs": {"drawing_id": "DWG-77", "material": "Steel", "quantity": 5}},
    )
    assert r_exec.status_code == 200, r_exec.text
    assert r_exec.json()["status"] in ("succeeded", "awaiting_approval")

    # 6. PUT direct update from Canvas Step Inspector
    r_put = client.put(
        "/v1/playbooks/quality-gate",
        headers=headers,
        json={"steps": [{"tool": "cmm_inspect", "params": {"standard": "ISO-2768"}}, {"tool": "notify_team", "params": {"message": "Done"}}]},
    )
    assert r_put.status_code == 200
    assert len(r_put.json()["playbook"]["steps"]) == 2
    assert r_put.json()["playbook"]["steps"][0]["params"]["standard"] == "ISO-2768"

    # 7. DELETE playbook
    r_del_pb = client.delete("/v1/playbooks/quality-gate", headers=headers)
    assert r_del_pb.status_code == 200
    assert r_del_pb.json()["deleted"] == "quality-gate"
    assert all(p["name"] != "quality-gate" for p in r_del_pb.json()["playbooks"])


def test_chat_route_playbook_edit_intent():
    client = TestClient(exec_app)
    headers = _auth_headers("admin")

    # Ensure seeded
    client.get("/v1/playbooks", headers=headers)

    r = client.post(
        "/v1/chat/message",
        headers=headers,
        json={"message": "In playbook production-setup, add slack_notify step at end"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("playbook_mutated") is True
    assert data["playbook"]["steps"][-1]["tool"] == "slack_notify"


def test_ocr_kv_and_academic_transcript_extraction_and_reprocess():
    ocr_text = (
        "--- Page 1 of 8 ---\n"
        "UNIVERSITY OF MUMBAI\n"
        "VASANTDADA PATIL PRATISHTHAN'S COLLEGE OF ENGINEERING AND VISUAL ARTS\n"
        "STUDENT'S NAME : SHAH AYAN JAVED JAMILA | SEAT NO : 313366\n"
        "COURSE : BACHELOR OF ENGINEERING (ARTIFICIAL INTELLIGENCE AND DATA SCIENCE)\n"
        "RESULT : PASSED | CGPI : 8.47\n"
    )
    extracted, _ = intel_mock.extract_text("ocr", ocr_text)
    assert extracted["doc_type"] == "document"
    fields = extracted["fields"]
    assert fields["student_s_name"] == "SHAH AYAN JAVED JAMILA"
    assert fields["cgpi"] == 8.47
    assert "full_text_excerpt" in fields
    assert "summary" in fields

    val = intel_validate.validate(fields, extracted["field_confidence"], extracted["missing"])
    assert val["overall_confidence"] >= 0.90
    assert val["needs_review"] is False

    # Confirm incomplete drawing still triggers needs_review
    inc, _ = intel_mock.extract_text("mock", "Drawing ID: DWG-9\nMaterial: Steel\n")
    assert inc["doc_type"] == "technical_drawing"
    assert inc["missing"] == ["quantity"]

    # Confirm POST /v1/documents/{doc_id}/reprocess & _get_documents_by_ids recovery
    doc_id = str(uuid.uuid4())
    ext_id = str(uuid.uuid4())
    storage_key = f"{TENANT_ID}/{doc_id}/transcript_notes.txt"
    intel_storage.put(storage_key, ocr_text.encode("utf-8"), "text/plain")

    with get_connection() as c:
        c.execute(
            "INSERT INTO documents (id, tenant_id, filename, mime_type, storage_key, status) "
            "VALUES (%s,%s,%s,%s,%s,'needs_review')",
            (doc_id, TENANT_ID, "transcript_notes.txt", "text/plain", storage_key),
        )
        c.execute(
            "INSERT INTO extractions (id, document_id, tenant_id, doc_type, fields, confidence, validation, decision) "
            "VALUES (%s,%s,%s,'document','{}',0.0,'{\"needs_review\":true}','{}')",
            (ext_id, doc_id, TENANT_ID),
        )
        c.commit()

    # On-demand chat attachment recovery
    recovered = _get_documents_by_ids(TENANT_ID, [doc_id])
    assert len(recovered) == 1
    assert recovered[0]["status"] == "ready"
    assert recovered[0]["confidence"] >= 0.90
    assert recovered[0]["fields"]["cgpi"] == 8.47

    # Also verify explicit /reprocess endpoint on intelligence service
    intel_client = TestClient(intel_app)
    r_rep = intel_client.post(f"/v1/documents/{doc_id}/reprocess", headers=_auth_headers("admin"))
    assert r_rep.status_code == 200, r_rep.text
    assert r_rep.json()["status"] == "ready"
    assert r_rep.json()["fields"]["cgpi"] == 8.47


def test_zero_emojis_in_new_components():
    emoji_re = re.compile(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]")
    for rel in (
        "apps/web/components/playbooks-manager.tsx",
        "apps/web/components/chat-interface.tsx",
        "services/execution/app/playbook_ai.py",
        "services/intelligence/app/ingest.py",
    ):
        with open(os.path.abspath(rel), "r", encoding="utf-8") as f:
            txt = f.read()
        assert not emoji_re.search(txt), f"Unexpected emoji in {rel}"
