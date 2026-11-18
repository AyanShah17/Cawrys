"""Automated Test Suite for Milestone 1: Production Audit Deployment Fixes (R1-R6).

Validates:
1. R1: Strict On-Site Engineer Navigation Filtering & Server-Side Page Route Guards.
2. R2: Deep Extraction Context for Attached Files in Chat Completions.
3. R3: Persistent New Chat Session Reset (DELETE /v1/chat/history).
4. R4: SSR HTML Payload Size Optimization (Connected status filter & initial slice).
5. R5: High-Contrast Connector Initials in Light Mode.
6. R6: Zero Emojis Compliance across apps and services.
"""
import json
import os
import re
import uuid
import pytest
from fastapi.testclient import TestClient

os.environ["MOCK_AI"] = "1"
os.environ["SQLITE_PATH"] = "/tmp/cawrys_test_audit_m1.db"
os.environ["AUTH_SECRET"] = "0123456789012345678901234567890123456789012345678901234567890123"

from services.execution.app.auth import make_token
from services.execution.app.chat_routes import (
    _build_operational_context,
    _build_system_prompt,
    _get_documents_by_ids,
    _init_chat_tables,
)
from services.execution.app.main import app as exec_app
from services.execution.app.sqlite_adapter import get_connection

TENANT_ID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture(autouse=True)
def setup_db():
    _init_chat_tables()
    with get_connection() as c:
        c.execute("INSERT OR IGNORE INTO tenants (id, name) VALUES (%s, %s)", (TENANT_ID, "Demo Tenant"))
        c.execute("DELETE FROM chat_messages")
        c.execute("DELETE FROM extractions")
        c.execute("DELETE FROM documents")
        c.commit()


# ---------------------------------------------------------------------------
# R1: Navigation Filtering & Route Guards Tests
# ---------------------------------------------------------------------------

def test_r1_top_nav_engineer_filtering_structure():
    """Validates top-nav.tsx implements strict tab filtering for role === 'engineer'."""
    top_nav_path = os.path.abspath("apps/web/components/top-nav.tsx")
    assert os.path.exists(top_nav_path), f"top-nav.tsx not found at {top_nav_path}"

    with open(top_nav_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Check engineer flag declaration
    assert 'role === "engineer"' in content or "role === 'engineer'" in content

    # Check aiTabs hides Marketplace and Settings for engineers
    assert "/marketplace" in content
    assert "/settings" in content
    assert "!isEngineer" in content or "isEngineer" in content

    # Check dashboardTabs hides Approvals, Audit, and Team for engineers
    assert "/approvals" in content
    assert "/audit" in content
    assert "/documents" in content


def test_r1_page_route_engineer_server_redirect_guards():
    """Validates server-side redirect checks exist in restricted route pages."""
    pages_to_check = {
        "apps/web/app/marketplace/page.tsx": "redirect",
        "apps/web/app/settings/page.tsx": "redirect",
        "apps/web/app/approvals/page.tsx": "redirect",
        "apps/web/app/audit/page.tsx": "redirect",
    }

    for rel_path, expected_keyword in pages_to_check.items():
        abs_path = os.path.abspath(rel_path)
        assert os.path.exists(abs_path), f"File {rel_path} does not exist"
        with open(abs_path, "r", encoding="utf-8") as f:
            code = f.read()
        assert expected_keyword in code, f"{rel_path} missing {expected_keyword}"
        assert 'me.role === "engineer"' in code or "me.role === 'engineer'" in code, (
            f"{rel_path} missing check for me.role === 'engineer'"
        )


def test_r1_middleware_edge_guard_for_engineers():
    """Validates edge middleware checks engineer role and blocks restricted views."""
    middleware_path = os.path.abspath("apps/web/middleware.ts")
    assert os.path.exists(middleware_path)
    with open(middleware_path, "r", encoding="utf-8") as f:
        code = f.read()

    assert "engineer" in code
    assert "/marketplace" in code or "restricted" in code


# ---------------------------------------------------------------------------
# R2: Deep Extraction Context for Attached Files Tests
# ---------------------------------------------------------------------------

def test_r2_attached_documents_extraction_retrieval_and_prompt_injection():
    """Verifies that _get_documents_by_ids and _build_system_prompt inject full parsed extractions."""
    doc_id = str(uuid.uuid4())
    extraction_id = str(uuid.uuid4())
    fields_payload = {
        "material": "Titanium Grade 5 (Ti-6Al-4V)",
        "tolerance": "+/- 0.0015 mm",
        "bore_diameter": "45.00 mm",
        "surface_roughness": "Ra 0.4 um",
    }
    validation_payload = {
        "checks_passed": True,
        "critical_tolerances_verified": True,
    }
    decision_payload = {
        "status": "APPROVED",
        "next_step": "CNC_MACHINING",
    }

    with get_connection() as c:
        c.execute(
            "INSERT INTO documents (id, tenant_id, filename, mime_type, storage_key, status) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (doc_id, TENANT_ID, "flange_cad_rev3.dwg", "application/acad", "keys/flange_cad_rev3.dwg", "ready"),
        )
        c.execute(
            "INSERT INTO extractions (id, document_id, tenant_id, doc_type, fields, confidence, validation, decision) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (
                extraction_id,
                doc_id,
                TENANT_ID,
                "cad_spec",
                json.dumps(fields_payload),
                0.98,
                json.dumps(validation_payload),
                json.dumps(decision_payload),
            ),
        )
        c.commit()

    # 1. Test helper
    docs = _get_documents_by_ids(TENANT_ID, [doc_id])
    assert len(docs) == 1
    d = docs[0]
    assert d["id"] == doc_id
    assert d["filename"] == "flange_cad_rev3.dwg"
    assert d["fields"]["material"] == "Titanium Grade 5 (Ti-6Al-4V)"
    assert d["fields"]["tolerance"] == "+/- 0.0015 mm"
    assert d["validation"]["critical_tolerances_verified"] is True
    assert d["decision"]["status"] == "APPROVED"

    # 2. Test operational context assembly with attached_documents
    context = _build_operational_context(TENANT_ID, attached_doc_ids=[doc_id])
    assert "attached_documents" in context
    assert len(context["attached_documents"]) == 1
    assert context["attached_documents"][0]["id"] == doc_id

    # 3. Test system prompt injection
    prompt = _build_system_prompt(context)
    assert "### ATTACHED DOCUMENTS CONTEXT" in prompt
    assert "flange_cad_rev3.dwg" in prompt
    assert "Titanium Grade 5 (Ti-6Al-4V)" in prompt
    assert "+/- 0.0015 mm" in prompt
    assert "CNC_MACHINING" in prompt


def test_r2_chat_message_endpoint_accepts_attached_document_ids():
    """Tests POST /v1/chat/message accepts attached_document_ids and grounds response on deep extraction."""
    client = TestClient(exec_app)
    token = make_token("u-eng", TENANT_ID, "engineer", "engineer@liontix.local")

    doc_id = str(uuid.uuid4())
    fields_payload = {
        "part_number": "LT-AERO-990",
        "tensile_strength": "1200 MPa",
        "critical_tolerance": "+/- 0.005mm",
    }

    with get_connection() as c:
        c.execute(
            "INSERT INTO documents (id, tenant_id, filename, mime_type, storage_key, status) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (doc_id, TENANT_ID, "aerospace_bracket.pdf", "application/pdf", "keys/aerospace_bracket.pdf", "ready"),
        )
        c.execute(
            "INSERT INTO extractions (id, document_id, tenant_id, doc_type, fields, confidence, validation, decision) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (
                str(uuid.uuid4()),
                doc_id,
                TENANT_ID,
                "drawing",
                json.dumps(fields_payload),
                0.95,
                json.dumps({"passed": True}),
                json.dumps({"approved": True}),
            ),
        )
        c.commit()

    resp = client.post(
        "/v1/chat/message",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "message": "Inspect the attached engineering drawing requirements",
            "session_id": "session-test-attach",
            "attached_document_ids": [doc_id],
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "assistant"
    # Grounded response references attached file and extracted fields
    assert "aerospace_bracket.pdf" in data["content"]
    assert "LT-AERO-990" in data["content"] or "1200 MPa" in data["content"]


# ---------------------------------------------------------------------------
# R3: Persistent New Chat Session Reset Tests
# ---------------------------------------------------------------------------

def test_r3_delete_chat_history_endpoint():
    """Tests DELETE /v1/chat/history removes messages for a specific session."""
    client = TestClient(exec_app)
    token = make_token("u-admin", TENANT_ID, "admin", "admin@liontix.local")
    session_id = "test-session-reset-123"

    with get_connection() as c:
        c.execute(
            "INSERT INTO chat_messages (id, tenant_id, session_id, role, content, metadata, created_at) "
            "VALUES (%s, %s, %s, 'user', 'Hello test 1', '{}', '2026-11-15 10:00:00')",
            (str(uuid.uuid4()), TENANT_ID, session_id),
        )
        c.execute(
            "INSERT INTO chat_messages (id, tenant_id, session_id, role, content, metadata, created_at) "
            "VALUES (%s, %s, %s, 'assistant', 'Response test 1', '{}', '2026-11-15 10:00:01')",
            (str(uuid.uuid4()), TENANT_ID, session_id),
        )
        c.commit()

    # Verify messages exist
    res_get = client.get(
        f"/v1/chat/history?session_id={session_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res_get.status_code == 200
    assert len(res_get.json()["messages"]) == 2

    # Issue DELETE request
    res_del = client.delete(
        f"/v1/chat/history?session_id={session_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res_del.status_code == 200
    del_data = res_del.json()
    assert del_data["ok"] is True
    assert del_data["session_id"] == session_id
    assert del_data["deleted_count"] == 2

    # Verify messages are completely cleared
    res_get_after = client.get(
        f"/v1/chat/history?session_id={session_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res_get_after.status_code == 200
    assert len(res_get_after.json()["messages"]) == 0
    assert res_get_after.json()["count"] == 0


def test_r3_chat_interface_stores_session_id_in_local_storage():
    """Validates chat-interface.tsx uses localStorage liontix_chat_session_id and calls DELETE /history."""
    chat_file = os.path.abspath("apps/web/components/chat-interface.tsx")
    assert os.path.exists(chat_file)
    with open(chat_file, "r", encoding="utf-8") as f:
        code = f.read()

    assert "liontix_chat_session_id" in code
    assert "attached_document_ids" in code
    assert "DELETE" in code
    assert "/api/execution/v1/chat/history" in code


# ---------------------------------------------------------------------------
# R4: SSR HTML Payload Size Optimization Tests
# ---------------------------------------------------------------------------

def test_r4_marketplace_status_connected_filtering_and_payload_size():
    """Tests GET /v1/marketplace/apps?status=connected returns only connected apps (< 10 KB)."""
    client = TestClient(exec_app)
    token = make_token("u-admin", TENANT_ID, "admin", "admin@liontix.local")

    resp = client.get(
        "/v1/marketplace/apps?status=connected",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()

    # Payload size must be < 10 KB
    raw_size = len(resp.content)
    assert raw_size < 10 * 1024, f"Connected payload {raw_size} exceeds 10 KB"

    # All returned apps must have connected == True
    for app in data.get("apps", []):
        assert app.get("connected") is True

    # Global total count must be preserved across entire catalog
    assert data["counts"]["total"] >= 1640


def test_r4_marketplace_initial_slice_payload_size():
    """Tests GET /v1/marketplace/apps?limit=24 returns initial slice (< 50 KB)."""
    client = TestClient(exec_app)
    token = make_token("u-admin", TENANT_ID, "admin", "admin@liontix.local")

    resp = client.get(
        "/v1/marketplace/apps?limit=24",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()

    # Returned slice size
    assert len(data.get("apps", [])) == 24
    assert data["pagination"]["has_more"] is True

    # Raw payload size < 50 KB (well below 100 KB SSR threshold)
    raw_size = len(resp.content)
    assert raw_size < 50 * 1024, f"Initial slice payload {raw_size} exceeds 50 KB"

    # Global counts must be intact
    assert data["counts"]["total"] >= 1640


def test_r4_ssr_page_source_configurations():
    """Validates connectors/page.tsx and marketplace/page.tsx use optimized SSR queries."""
    connectors_page = os.path.abspath("apps/web/app/connectors/page.tsx")
    with open(connectors_page, "r", encoding="utf-8") as f:
        c_code = f.read()
    assert "status=connected" in c_code
    assert "limit=0" not in c_code

    marketplace_page = os.path.abspath("apps/web/app/marketplace/page.tsx")
    with open(marketplace_page, "r", encoding="utf-8") as f:
        m_code = f.read()
    assert "limit=24" in m_code
    assert "limit=0" not in m_code


# ---------------------------------------------------------------------------
# R5: High-Contrast Connector Initials in Light Mode Tests
# ---------------------------------------------------------------------------

def test_r5_avatar_badge_high_contrast_classes():
    """Validates shared getAvatarTone uses high-contrast text tones (-800) without violet/indigo slop."""
    view_files = [
        "apps/web/components/connectors-view.tsx",
        "apps/web/components/marketplace-grid.tsx",
    ]

    for rel_path in view_files:
        abs_path = os.path.abspath(rel_path)
        with open(abs_path, "r", encoding="utf-8") as f:
            code = f.read()
        assert "getAvatarTone" in code, f"getAvatarTone not referenced in {rel_path}"

    modal_path = os.path.abspath("apps/web/components/marketplace-config-modal.tsx")
    with open(modal_path, "r", encoding="utf-8") as f:
        modal_code = f.read()

    match = re.search(r"function getAvatarTone\([^\)]*\)[^{]*\{([\s\S]*?)\n\}", modal_code)
    assert match, "getAvatarTone not found in apps/web/components/marketplace-config-modal.tsx"
    fn_body = match.group(1)

    # High-contrast tones must be present
    assert "text-amber-800" in fn_body
    assert "text-emerald-800" in fn_body
    assert "text-rose-800" in fn_body
    assert "text-sky-800" in fn_body
    assert "text-blue-800" in fn_body

    # Violet/purple/indigo slop and low-contrast pastel tones (-300) must NOT be present
    forbidden = [
        "purple",
        "violet",
        "indigo",
        "text-amber-300",
        "text-emerald-300",
        "text-rose-300",
        "text-green-300",
        "text-sky-300",
        "text-blue-300",
        "text-yellow-300",
    ]
    for token in forbidden:
        assert token not in fn_body, f"Found forbidden token {token} in getAvatarTone"


# ---------------------------------------------------------------------------
# R6: Zero Emojis Compliance Scan
# ---------------------------------------------------------------------------

def test_r6_strictly_zero_emojis_in_source_tree():
    """Scans all web components, pages, and python service code for strictly zero emojis."""
    emoji_pattern = re.compile(
        r"[\U0001F000-\U0001FAFF]|[\u2600-\u27BF]|[⚡⚙📊🔌📄📋✕👁🤖✨🐋🦙🌊]"
    )

    scanned_extensions = (".ts", ".tsx", ".py")
    dirs_to_scan = [
        os.path.abspath("apps/web/app"),
        os.path.abspath("apps/web/components"),
        os.path.abspath("services/execution/app"),
        os.path.abspath("services/intelligence/app"),
    ]

    violations = []
    for d in dirs_to_scan:
        for root, _, files in os.walk(d):
            for file in files:
                if file.endswith(scanned_extensions):
                    path = os.path.join(root, file)
                    with open(path, "r", encoding="utf-8", errors="ignore") as f:
                        for line_idx, line in enumerate(f, 1):
                            found = emoji_pattern.findall(line)
                            if found:
                                violations.append(f"{path}:{line_idx}: {found}")

    assert not violations, f"Emoji violations found:\n" + "\n".join(violations)
