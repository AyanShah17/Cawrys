"""Tests for MarkItDown OCR conversion, the workspace documents FastMCP toolkit,
and the post-retrieval ContextBuilder.

Covers:
1. MarkItDownConverter.convert_bytes_to_markdown for digital PDFs, scanned PDFs (OCR path),
   images (OCR path), text, JSON, CSV, and the actual TOEFL_Score_Report.pdf when present on disk.
2. ensure_document_markdown: lazy conversion, .md artifact saved in storage, markdown_key /
   markdown_content cached on the extraction row, and cache re-use without re-conversion.
3. document_mcp FastMCP tools: workspace_list_documents, workspace_search_documents,
   workspace_read_document_markdown (via call_tool) plus REST registration.
4. ToolkitExplorer + ContextBuilder: no autoloading of workspace document filenames on unrelated
   queries; retrieved Markdown injected only post-retrieval.
5. End-to-end POST /v1/chat/message in a brand-new session with attached_document_ids=[]:
   asking "What is my TOEFL score?" explores the workspace_documents toolkit, retrieves the .md,
   records the "Workspace Documents MCP" tool call, and answers with the real score.
6. Unrelated prompts ("hello", "Explain CNC cooling") never retrieve documents.
"""
import json
import os
import re
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MOCK_AI", "1")
os.environ.setdefault("SQLITE_PATH", "/tmp/cawrys_test_markitdown_mcp.db")
os.environ.setdefault("AUTH_SECRET", "0123456789012345678901234567890123456789012345678901234567890123")

from services.execution.app import chat_routes, industrial_mcp
from services.execution.app.auth import make_token
from services.execution.app.context_builder import ContextBuilder, ToolkitExplorer
from services.execution.app.industrial_mcp import document_mcp
from services.execution.app.main import app as exec_app
from services.execution.app.sqlite_adapter import get_connection
from services.intelligence.app import ingest, markitdown_converter, storage
from services.intelligence.app.markitdown_converter import (
    MarkItDownConverter,
    ensure_document_markdown,
    get_markdown_storage_key,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
REAL_TOEFL_PDF = next(iter(sorted((REPO_ROOT / "data" / "files").glob("**/TOEFL_Score_Report.pdf"))), None) if (
    REPO_ROOT / "data" / "files"
).exists() else None

TOEFL_LINES = [
    "TOEFL iBT Test Taker Score Report",
    "Name: Test Candidate",
    "Total Score: 100 of 120",
    "Reading 26 of 30",
    "Listening 25 of 30",
    "Speaking 24 of 30",
    "Writing 25 of 30",
    "CEFR Level : C1",
]

_EMOJI_RE = re.compile(r"[\U0001F000-\U0001FFFF\u2600-\u27BF\u2B50\u2B55\uFE00-\uFE0F]")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_pdf_bytes(lines):
    """Builds a minimal valid single-page PDF containing the given text lines (empty list = blank page)."""
    ops = []
    if lines:
        ops.append("BT /F1 12 Tf 50 750 Td 16 TL")
        for ln in lines:
            safe = ln.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            ops.append(f"({safe}) Tj T*")
        ops.append("ET")
    stream = "\n".join(ops).encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref_pos = len(out)
    out += f"xref\n0 {len(objs) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode()
    return bytes(out)


def assert_no_emojis(text):
    assert not _EMOJI_RE.search(text or ""), "output must contain zero emojis"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    """Isolates the SQLite DB and the storage provider from the real data directories."""
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "md_test.db"))
    provider = storage.LocalStorageProvider(tmp_path / "store")
    monkeypatch.setattr(storage, "get_storage", lambda: provider)
    return provider


@pytest.fixture
def workspace(isolated_env):
    """Fresh tenant with a TOEFL PDF, a CNC spec text file, and no cached Markdown."""
    provider = isolated_env
    tenant_id = str(uuid.uuid4())
    toefl_id = str(uuid.uuid4())
    cnc_id = str(uuid.uuid4())

    toefl_key = f"{tenant_id}/{toefl_id}/TOEFL_Score_Report.pdf"
    cnc_key = f"{tenant_id}/{cnc_id}/Spindle-Coolant-Notes.txt"
    provider.put(toefl_key, make_pdf_bytes(TOEFL_LINES), "application/pdf")
    provider.put(cnc_key, b"Spindle coolant flow must stay above 4 liters per minute.", "text/plain")

    with get_connection() as c:
        c.execute("INSERT INTO tenants (id, name) VALUES (%s, %s)", (tenant_id, "MD Test Tenant"))
        c.execute(
            "INSERT INTO documents (id, tenant_id, filename, mime_type, storage_key, status) "
            "VALUES (%s,%s,%s,%s,%s,'ready')",
            (toefl_id, tenant_id, "TOEFL_Score_Report.pdf", "application/pdf", toefl_key),
        )
        c.execute(
            "INSERT INTO documents (id, tenant_id, filename, mime_type, storage_key, status) "
            "VALUES (%s,%s,%s,%s,%s,'ready')",
            (cnc_id, tenant_id, "Spindle-Coolant-Notes.txt", "text/plain", cnc_key),
        )
        c.commit()

    return {
        "tenant_id": tenant_id,
        "toefl_id": toefl_id,
        "cnc_id": cnc_id,
        "toefl_key": toefl_key,
        "provider": provider,
    }


@pytest.fixture
def client():
    return TestClient(exec_app)


@pytest.fixture
def captured_llm(monkeypatch):
    """Captures LLM messages and forces the contextual synthesis fallback (no live AI)."""
    captured = {"calls": []}

    def fake_completion(messages, **kwargs):
        captured["calls"].append(messages)
        return "", "live AI disabled in tests"

    monkeypatch.setattr(chat_routes, "_execute_litellm_completion", fake_completion)
    return captured


def auth_for(tenant_id):
    token = make_token("u-md-test", tenant_id, "admin", "admin@cawrys.local")
    return {"Authorization": f"Bearer {token}"}


def system_prompt_of(captured):
    assert captured["calls"], "LLM completion was never invoked"
    return captured["calls"][-1][0]["content"]


# ---------------------------------------------------------------------------
# 1. MarkItDownConverter.convert_bytes_to_markdown
# ---------------------------------------------------------------------------

def test_convert_digital_pdf_to_markdown():
    res = MarkItDownConverter.convert_bytes_to_markdown(
        make_pdf_bytes(TOEFL_LINES), "TOEFL_Score_Report.pdf", "application/pdf"
    )
    assert set(("markdown", "ocr_used", "page_count", "kind")).issubset(res)
    assert res["kind"] == "pdf"
    assert res["ocr_used"] is False
    assert res["page_count"] == 1
    md = res["markdown"]
    assert md.startswith("# TOEFL_Score_Report.pdf")
    assert "- **Kind**: pdf" in md
    assert "- **OCR Used**: No" in md
    assert "- **Pages**: 1" in md
    assert "## Page 1" in md
    assert "100 of 120" in md
    assert "C1" in md
    assert_no_emojis(md)


def test_convert_scanned_pdf_uses_ocr(monkeypatch):
    calls = []

    def fake_ocr(data, mode="pdf", ext=".bin", max_pages=12):
        calls.append(mode)
        return "--- Page 1 of 1 ---\nTOEFL iBT Score Report\nTotal Score: 100 of 120\nCEFR Level : C1"

    monkeypatch.setattr(ingest, "_ocr_pdf_or_image_bytes", fake_ocr)
    res = MarkItDownConverter.convert_bytes_to_markdown(
        make_pdf_bytes([]), "scan.pdf", "application/pdf", use_ocr=True
    )
    assert calls == ["pdf"]
    assert res["ocr_used"] is True
    assert "- **OCR Used**: Yes" in res["markdown"]
    assert "## Page 1" in res["markdown"]
    assert "100 of 120" in res["markdown"]
    assert "--- Page" not in res["markdown"]


def test_convert_scanned_pdf_without_ocr_does_not_call_ocr(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("OCR must not run when use_ocr=False")

    monkeypatch.setattr(ingest, "_ocr_pdf_or_image_bytes", boom)
    res = MarkItDownConverter.convert_bytes_to_markdown(
        make_pdf_bytes([]), "scan.pdf", "application/pdf", use_ocr=False
    )
    assert res["ocr_used"] is False
    assert res["kind"] == "pdf"


def test_convert_image_uses_ocr(monkeypatch):
    seen = {}

    def fake_ocr(data, mode="pdf", ext=".bin", max_pages=12):
        seen["mode"] = mode
        seen["ext"] = ext
        return "Drawing ID: DWG-77\nMaterial: Brass"

    monkeypatch.setattr(ingest, "_ocr_pdf_or_image_bytes", fake_ocr)
    res = MarkItDownConverter.convert_bytes_to_markdown(b"\x89PNG\r\n\x1a\nfakeimage", "photo.png", "image/png")
    assert seen["mode"] == "image"
    assert res["kind"] == "image"
    assert res["ocr_used"] is True
    assert "DWG-77" in res["markdown"]
    assert "## Document Content" in res["markdown"]
    assert_no_emojis(res["markdown"])


def test_convert_text_json_and_csv():
    txt = MarkItDownConverter.convert_bytes_to_markdown(b"Line one\nLine two\n", "notes.txt", "text/plain")
    assert txt["kind"] == "text"
    assert "# notes.txt" in txt["markdown"]
    assert "Line one" in txt["markdown"] and "Line two" in txt["markdown"]

    js = MarkItDownConverter.convert_bytes_to_markdown(b'{"a": 1, "b": [2, 3]}', "data.json", "application/json")
    assert "```json" in js["markdown"]
    assert '"a": 1' in js["markdown"]

    csv_res = MarkItDownConverter.convert_bytes_to_markdown(b"part,qty\nflange,4\nbolt,9\n", "bom.csv", "text/csv")
    assert "| part | qty |" in csv_res["markdown"]
    assert "| --- | --- |" in csv_res["markdown"]
    assert "| flange | 4 |" in csv_res["markdown"]


def test_convert_empty_bytes_is_placeholder_not_crash():
    res = MarkItDownConverter.convert_bytes_to_markdown(b"", "empty.txt", "text/plain")
    assert res["page_count"] == 0
    assert "[Empty document]" in res["markdown"]


def test_convert_strips_emojis_from_output():
    res = MarkItDownConverter.convert_bytes_to_markdown(
        "Status \U0001F600 ok \u2705 done".encode("utf-8"), "emoji.txt", "text/plain"
    )
    assert "Status" in res["markdown"] and "done" in res["markdown"]
    assert_no_emojis(res["markdown"])


def test_markdown_storage_key_format():
    assert get_markdown_storage_key("tenant-1", "doc-9", "TOEFL_Score_Report.pdf") == "tenant-1/doc-9/TOEFL_Score_Report.md"
    assert MarkItDownConverter.get_markdown_storage_key("t", "d", "a.b.docx") == "t/d/a.b.md"


@pytest.mark.skipif(REAL_TOEFL_PDF is None, reason="actual TOEFL_Score_Report.pdf not present on disk")
def test_convert_real_toefl_pdf_contains_real_scores():
    data = REAL_TOEFL_PDF.read_bytes()
    res = MarkItDownConverter.convert_bytes_to_markdown(data, "TOEFL_Score_Report.pdf", "application/pdf")
    md = res["markdown"]
    assert res["kind"] == "pdf"
    assert md.startswith("# TOEFL_Score_Report.pdf")
    assert "100" in md and "120" in md
    assert "C1" in md
    assert_no_emojis(md)


# ---------------------------------------------------------------------------
# 2. ensure_document_markdown: storage artifact + cache
# ---------------------------------------------------------------------------

def _doc_row(c, doc_id):
    row = c.execute(
        "SELECT d.id, d.filename, d.mime_type, d.storage_key, d.status, e.doc_type, e.fields, e.confidence "
        "FROM documents d LEFT JOIN extractions e ON e.document_id = d.id WHERE d.id=%s",
        (doc_id,),
    ).fetchone()
    return dict(row)


def test_ensure_document_markdown_converts_saves_artifact_and_caches(workspace, monkeypatch):
    tenant_id, doc_id = workspace["tenant_id"], workspace["toefl_id"]
    provider = workspace["provider"]
    expected_key = f"{tenant_id}/{doc_id}/TOEFL_Score_Report.md"

    with get_connection() as c:
        row = _doc_row(c, doc_id)
        out = ensure_document_markdown(c, tenant_id, row, persist=True)

        assert out["id"] == doc_id
        assert out["filename"] == "TOEFL_Score_Report.pdf"
        assert out["markdown_key"] == expected_key
        assert "100 of 120" in out["markdown_content"]
        assert "C1" in out["markdown_content"]
        assert out["fields"]["markdown_key"] == expected_key
        assert out["fields"]["markdown_content"] == out["markdown_content"][:24000]
        assert "100 of 120" in out["fields"]["full_text_excerpt"]

        # .md artifact saved in storage
        stored = provider.get(expected_key)
        assert stored is not None
        assert "100 of 120" in stored.decode("utf-8")

        # cached on the extractions row
        ex = c.execute(
            "SELECT fields FROM extractions WHERE document_id=%s AND tenant_id=%s", (doc_id, tenant_id)
        ).fetchone()
        cached_fields = ex["fields"] if isinstance(ex["fields"], dict) else json.loads(ex["fields"])
        assert cached_fields["markdown_key"] == expected_key
        assert "100 of 120" in cached_fields["markdown_content"]

        # second call must reuse the cache and never re-convert
        def boom(*args, **kwargs):
            raise AssertionError("conversion must not run when markdown is cached")

        monkeypatch.setattr(markitdown_converter, "convert_bytes_to_markdown", boom)
        monkeypatch.setattr(MarkItDownConverter, "convert_bytes_to_markdown", staticmethod(boom))
        row2 = _doc_row(c, doc_id)
        out2 = ensure_document_markdown(c, tenant_id, row2, persist=True)
        assert out2["markdown_content"] == out["markdown_content"]
        assert out2["markdown_key"] == expected_key


def test_ensure_document_markdown_reads_cached_md_from_storage(workspace, monkeypatch):
    tenant_id, doc_id = workspace["tenant_id"], workspace["toefl_id"]
    md_key = f"{tenant_id}/{doc_id}/TOEFL_Score_Report.md"
    workspace["provider"].put(
        md_key, b"# TOEFL_Score_Report.pdf\n\n## Page 1\n\nTotal Score: 100 of 120\n", "text/markdown"
    )

    def boom(*args, **kwargs):
        raise AssertionError("raw conversion must be skipped when .md artifact exists")

    monkeypatch.setattr(MarkItDownConverter, "convert_bytes_to_markdown", staticmethod(boom))
    with get_connection() as c:
        out = ensure_document_markdown(c, tenant_id, _doc_row(c, doc_id), persist=False)
    assert "100 of 120" in out["markdown_content"]
    assert out["markdown_key"] == md_key


def test_ensure_document_markdown_ocr_path_for_scanned_pdf(isolated_env, monkeypatch):
    provider = isolated_env
    tenant_id, doc_id = str(uuid.uuid4()), str(uuid.uuid4())
    key = f"{tenant_id}/{doc_id}/Scanned_Score.pdf"
    provider.put(key, make_pdf_bytes([]), "application/pdf")

    monkeypatch.setattr(
        ingest,
        "_ocr_pdf_or_image_bytes",
        lambda data, mode="pdf", ext=".bin", max_pages=12: "--- Page 1 of 1 ---\nTotal Score: 100 of 120\nCEFR Level : C1",
    )
    row = {
        "id": doc_id,
        "filename": "Scanned_Score.pdf",
        "mime_type": "application/pdf",
        "storage_key": key,
        "status": "ready",
        "doc_type": "document",
        "fields": "{}",
    }
    out = ensure_document_markdown(None, tenant_id, row, persist=False)
    assert out["ocr_used"] is True
    assert "- **OCR Used**: Yes" in out["markdown_content"]
    assert "100 of 120" in out["markdown_content"]
    assert provider.get(f"{tenant_id}/{doc_id}/Scanned_Score.md") is not None


def test_ensure_document_markdown_returns_prefilled_markdown_unchanged(isolated_env):
    row = {
        "id": "doc-1",
        "filename": "x.pdf",
        "doc_type": "document",
        "status": "ready",
        "fields": json.dumps({"markdown_content": "# x.pdf\n\n## Page 1\n\nTotal Score: 100 of 120\n"}),
    }
    out = ensure_document_markdown(None, "tenant-x", row, persist=False)
    assert "100 of 120" in out["markdown_content"]
    assert out["markdown_key"] == "tenant-x/doc-1/x.md"


@pytest.mark.skipif(REAL_TOEFL_PDF is None, reason="actual TOEFL_Score_Report.pdf not present on disk")
def test_ensure_document_markdown_with_real_toefl_pdf(isolated_env):
    provider = isolated_env
    tenant_id, doc_id = str(uuid.uuid4()), str(uuid.uuid4())
    key = f"{tenant_id}/{doc_id}/TOEFL_Score_Report.pdf"
    provider.put(key, REAL_TOEFL_PDF.read_bytes(), "application/pdf")
    row = {
        "id": doc_id,
        "filename": "TOEFL_Score_Report.pdf",
        "mime_type": "application/pdf",
        "storage_key": key,
        "status": "ready",
        "fields": {},
    }
    out = ensure_document_markdown(None, tenant_id, row, persist=False)
    md = out["markdown_content"]
    assert "100" in md and "120" in md and "C1" in md
    stored = provider.get(f"{tenant_id}/{doc_id}/TOEFL_Score_Report.md")
    assert stored is not None and b"C1" in stored


# ---------------------------------------------------------------------------
# 3. document_mcp FastMCP tools
# ---------------------------------------------------------------------------

def test_document_mcp_registers_three_tools():
    assert document_mcp.name == "workspace_documents"
    assert {"workspace_list_documents", "workspace_search_documents", "workspace_read_document_markdown"}.issubset(
        set(document_mcp.tools)
    )
    assert industrial_mcp.MCP_SERVERS["workspace_documents"] is document_mcp


def test_workspace_list_documents_returns_metadata_only(workspace):
    res = document_mcp.call_tool("workspace_list_documents", {"tenant_id": workspace["tenant_id"]})
    assert res["ok"] is True
    docs = {d["filename"]: d for d in res["documents"]}
    assert set(docs) == {"TOEFL_Score_Report.pdf", "Spindle-Coolant-Notes.txt"}
    for d in docs.values():
        assert {"id", "filename", "doc_type", "status", "markdown_key", "created_at"}.issubset(d)
        assert "markdown_content" not in d


def test_workspace_list_documents_is_tenant_scoped(workspace, isolated_env):
    other = str(uuid.uuid4())
    with get_connection() as c:
        c.execute("INSERT INTO tenants (id, name) VALUES (%s, %s)", (other, "Other Tenant"))
        c.commit()
    res = document_mcp.call_tool("workspace_list_documents", {"tenant_id": other})
    assert res["ok"] is True
    assert res["documents"] == []


def test_workspace_read_document_markdown_by_filename(workspace):
    res = document_mcp.call_tool(
        "workspace_read_document_markdown",
        {"tenant_id": workspace["tenant_id"], "filename": "TOEFL_Score_Report.pdf"},
    )
    assert res["ok"] is True
    doc = res["document"]
    assert doc["filename"] == "TOEFL_Score_Report.pdf"
    assert doc["markdown_key"].endswith("/TOEFL_Score_Report.md")
    assert "100 of 120" in doc["markdown_content"]
    assert "C1" in doc["markdown_content"]
    assert workspace["provider"].get(doc["markdown_key"]) is not None


def test_workspace_read_document_markdown_by_id(workspace):
    res = document_mcp.call_tool(
        "workspace_read_document_markdown",
        {"tenant_id": workspace["tenant_id"], "document_id": workspace["toefl_id"]},
    )
    assert res["ok"] is True
    assert res["document"]["id"] == workspace["toefl_id"]
    assert "100 of 120" in res["document"]["markdown_content"]


def test_workspace_read_document_markdown_missing_document(workspace):
    res = document_mcp.call_tool(
        "workspace_read_document_markdown",
        {"tenant_id": workspace["tenant_id"], "filename": "does_not_exist.pdf"},
    )
    assert res["ok"] is False
    assert "not found" in res["error"].lower()


def test_workspace_search_documents_ranks_matching_doc_with_markdown(workspace):
    res = document_mcp.call_tool(
        "workspace_search_documents",
        {"tenant_id": workspace["tenant_id"], "query": "What is my TOEFL score?"},
    )
    assert res["ok"] is True
    docs = res["documents"]
    assert docs, "TOEFL query must match the TOEFL document"
    assert docs[0]["filename"] == "TOEFL_Score_Report.pdf"
    assert "100 of 120" in docs[0]["markdown_content"]
    assert "C1" in docs[0]["markdown_content"]


def test_workspace_search_documents_matches_markdown_body_content(workspace):
    res = document_mcp.call_tool(
        "workspace_search_documents",
        {"tenant_id": workspace["tenant_id"], "query": "coolant flow liters"},
    )
    assert res["ok"] is True
    names = [d["filename"] for d in res["documents"]]
    assert "Spindle-Coolant-Notes.txt" in names
    assert "TOEFL_Score_Report.pdf" not in names


def test_workspace_documents_rest_registration_and_industrial_catalog_unchanged(client):
    tools = client.get("/v1/mcp/servers/workspace_documents/tools")
    assert tools.status_code == 200
    names = {t["name"] for t in tools.json()}
    assert {"workspace_list_documents", "workspace_search_documents", "workspace_read_document_markdown"}.issubset(
        names
    )
    servers = client.get("/v1/mcp/servers").json()
    assert len(servers) == 6
    assert "workspace_documents" not in {s["key"] for s in servers}


# ---------------------------------------------------------------------------
# 4. ToolkitExplorer + ContextBuilder
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("query", ["hi", "hello", "Explain CNC cooling", "how does CNC cooling work?", "check SAP stock"])
def test_toolkit_explorer_skips_unrelated_queries(workspace, query):
    res = ToolkitExplorer.explore_and_retrieve(
        tenant_id=workspace["tenant_id"], user_query=query, attached_doc_ids=[], connections=[], tools=[]
    )
    assert res["retrieved_documents"] == []
    assert res["document_tool_call"] is None


def test_toolkit_explorer_retrieves_toefl_markdown(workspace):
    res = ToolkitExplorer.explore_and_retrieve(
        tenant_id=workspace["tenant_id"],
        user_query="What is my TOEFL score?",
        attached_doc_ids=[],
        connections=[],
        tools=[],
    )
    assert "workspace_documents" in res["toolkits_explored"]
    call = res["document_tool_call"]
    assert call["app"] == "Workspace Documents MCP"
    assert call["connector"] == "fastmcp"
    assert call["tool"] in ("workspace_search_documents", "workspace_read_document_markdown")
    docs = res["retrieved_documents"]
    assert [d["filename"] for d in docs][0] == "TOEFL_Score_Report.pdf"
    assert "100 of 120" in docs[0]["markdown_content"]


def test_toolkit_explorer_attached_ids_use_read_tool(workspace):
    res = ToolkitExplorer.explore_and_retrieve(
        tenant_id=workspace["tenant_id"],
        user_query="Summarize this",
        attached_doc_ids=[workspace["toefl_id"]],
        connections=[],
        tools=[],
    )
    assert res["document_tool_call"]["tool"] == "workspace_read_document_markdown"
    assert res["retrieved_documents"][0]["id"] == workspace["toefl_id"]
    assert "C1" in res["retrieved_documents"][0]["markdown_content"]


def _base_context(**extra):
    ctx = {
        "metrics": {
            "oee": "89.2%",
            "production_target": "1,200 units",
            "operational_status": "Optimal",
            "system_health": "Nominal",
            "risk_level": "NORMAL",
            "active_work_orders": 12,
            "active_documents": 8,
        },
        "connections": [],
        "tools": [],
        "attached_documents": [],
        "retrieved_documents": [],
        "documents": [{"filename": "TOEFL_Score_Report.pdf", "doc_type": "document", "status": "ready"}],
    }
    ctx.update(extra)
    return ctx


def test_context_builder_does_not_autoload_workspace_documents():
    prompt = ContextBuilder.build_system_prompt(_base_context())
    assert "RECENT WORKSPACE DOCUMENTS" not in prompt
    assert "TOEFL_Score_Report.pdf" not in prompt
    assert "RETRIEVED DOCUMENT MARKDOWN" not in prompt
    assert "ATTACHED DOCUMENTS CONTEXT" not in prompt
    assert "### CURRENT OPERATIONAL CONTEXT (INTERNAL REFERENCE" in prompt
    assert "GitHub Flavored Markdown" in prompt
    assert "ZERO emojis" in prompt
    assert_no_emojis(prompt)


def test_context_builder_injects_retrieved_markdown_post_retrieval():
    ctx = _base_context(
        retrieved_documents=[
            {
                "id": "d1",
                "filename": "TOEFL_Score_Report.pdf",
                "doc_type": "document",
                "status": "ready",
                "markdown_key": "t/d1/TOEFL_Score_Report.md",
                "markdown_content": "# TOEFL_Score_Report.pdf\n\n## Page 1\n\nTotal Score: 100 of 120\nCEFR Level : C1\n",
                "fields": {},
            }
        ]
    )
    prompt = ContextBuilder.build_system_prompt(ctx)
    assert "### RETRIEVED DOCUMENT MARKDOWN (VIA MCP TOOLKIT workspace_documents):" in prompt
    assert "TOEFL_Score_Report.pdf" in prompt
    assert "100 of 120" in prompt
    assert "C1" in prompt
    assert "RECENT WORKSPACE DOCUMENTS" not in prompt
    assert_no_emojis(prompt)


def test_context_builder_keeps_attached_documents_contract():
    ctx = _base_context(
        attached_documents=[
            {
                "id": "a1",
                "filename": "Drawing.pdf",
                "doc_type": "technical_drawing",
                "status": "ready",
                "fields": {"drawing_id": "DWG-1", "markdown_content": "# Drawing.pdf\n\nTolerance: 0.05\n"},
            }
        ]
    )
    prompt = ContextBuilder.build_system_prompt(ctx)
    assert "### ATTACHED DOCUMENTS CONTEXT" in prompt
    assert "Drawing.pdf" in prompt
    assert "DWG-1" in prompt
    assert "Tolerance: 0.05" in prompt
    assert "TOEFL_Score_Report.pdf" not in prompt


def test_chat_routes_build_system_prompt_delegates_to_context_builder():
    ctx = _base_context()
    assert chat_routes._build_system_prompt(ctx) == ContextBuilder.build_system_prompt(ctx)


# ---------------------------------------------------------------------------
# 5. End-to-end POST /v1/chat/message
# ---------------------------------------------------------------------------

def test_e2e_toefl_question_explores_mcp_and_answers_with_real_score(workspace, client, captured_llm):
    session_id = f"sess-{uuid.uuid4()}"
    res = client.post(
        "/v1/chat/message",
        json={
            "message": "What is my TOEFL score?",
            "session_id": session_id,
            "attached_document_ids": [],
        },
        headers=auth_for(workspace["tenant_id"]),
    )
    assert res.status_code == 200, res.text
    data = res.json()

    # MCP tool call recorded
    assert data["tool_executed"] is True
    apps = [tc["app"] for tc in data["tool_calls"]]
    assert "Workspace Documents MCP" in apps
    meta = data["metadata"]
    assert meta["document_tool_call"]["app"] == "Workspace Documents MCP"
    assert "workspace_documents" in meta["toolkits_explored"]
    assert workspace["toefl_id"] in meta["retrieved_document_ids"]
    assert meta["action"] == "document_mcp_retrieval"

    # Context built post-retrieval with MarkItDown Markdown
    prompt = system_prompt_of(captured_llm)
    assert "### RETRIEVED DOCUMENT MARKDOWN (VIA MCP TOOLKIT workspace_documents):" in prompt
    assert "TOEFL_Score_Report.pdf" in prompt
    assert "100 of 120" in prompt
    assert "RECENT WORKSPACE DOCUMENTS" not in prompt
    assert "Spindle-Coolant-Notes.txt" not in prompt

    # Reply contains the real score values
    content = data["content"]
    assert "100" in content
    assert "120" in content
    assert "C1" in content
    assert_no_emojis(content)

    # .md artifact now exists in storage and is cached
    md_key = f"{workspace['tenant_id']}/{workspace['toefl_id']}/TOEFL_Score_Report.md"
    assert workspace["provider"].get(md_key) is not None

    # new session history was recorded under the brand-new session id
    hist = client.get(
        "/v1/chat/history", params={"session_id": session_id}, headers=auth_for(workspace["tenant_id"])
    )
    assert hist.status_code == 200


def test_e2e_toefl_question_with_default_session_and_no_attachments_field(workspace, client, captured_llm):
    res = client.post(
        "/v1/chat/message",
        json={"message": "What is my TOEFL score?", "session_id": f"sess-{uuid.uuid4()}"},
        headers=auth_for(workspace["tenant_id"]),
    )
    assert res.status_code == 200
    content = res.json()["content"]
    assert "100" in content and "120" in content and "C1" in content


def test_e2e_attached_document_ids_still_supported(workspace, client, captured_llm):
    res = client.post(
        "/v1/chat/message",
        json={
            "message": "Summarize this document",
            "session_id": f"sess-{uuid.uuid4()}",
            "attached_document_ids": [workspace["toefl_id"]],
        },
        headers=auth_for(workspace["tenant_id"]),
    )
    assert res.status_code == 200, res.text
    prompt = system_prompt_of(captured_llm)
    assert "### ATTACHED DOCUMENTS CONTEXT" in prompt
    assert "TOEFL_Score_Report.pdf" in prompt
    assert "100 of 120" in prompt


# ---------------------------------------------------------------------------
# 6. Unrelated prompts never retrieve documents
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("message", ["hello", "Explain CNC cooling"])
def test_e2e_unrelated_prompt_does_not_retrieve_documents(workspace, client, captured_llm, message):
    res = client.post(
        "/v1/chat/message",
        json={
            "message": message,
            "session_id": f"sess-{uuid.uuid4()}",
            "attached_document_ids": [],
        },
        headers=auth_for(workspace["tenant_id"]),
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["tool_executed"] is False
    assert not data.get("tool_calls")
    meta = data["metadata"]
    assert not meta.get("document_tool_call")
    assert not meta.get("retrieved_document_ids")
    assert meta.get("action") != "document_mcp_retrieval"

    prompt = system_prompt_of(captured_llm)
    assert "RETRIEVED DOCUMENT MARKDOWN" not in prompt
    assert "ATTACHED DOCUMENTS CONTEXT" not in prompt
    assert "RECENT WORKSPACE DOCUMENTS" not in prompt
    assert "TOEFL_Score_Report.pdf" not in prompt
    assert "Spindle-Coolant-Notes.txt" not in prompt

    content = data["content"]
    assert "TOEFL" not in content
    assert "100 of 120" not in content
    assert_no_emojis(content)

    # No markdown artifact should have been generated for an unrelated prompt
    md_key = f"{workspace['tenant_id']}/{workspace['toefl_id']}/TOEFL_Score_Report.md"
    assert workspace["provider"].get(md_key) is None


def test_mcp_to_openai_tools_and_toolkit_explorer_schemas():
    """Validates FastMCP to_openai_tools and ToolkitExplorer.get_tool_definitions schema bindings."""
    from services.execution.app.industrial_mcp import document_mcp, sap_mcp
    from services.execution.app.context_builder import ToolkitExplorer

    doc_tools = document_mcp.to_openai_tools()
    assert len(doc_tools) >= 3
    tool_names = {t["function"]["name"] for t in doc_tools}
    assert "workspace_list_documents" in tool_names
    assert "workspace_search_documents" in tool_names
    assert "workspace_read_document_markdown" in tool_names

    for t in doc_tools:
        assert t["type"] == "function"
        fn = t["function"]
        assert "name" in fn and "description" in fn and "parameters" in fn
        assert fn["parameters"].get("type") == "object"
        assert_no_emojis(fn["description"])

    explorer_tools = ToolkitExplorer.get_tool_definitions(["workspace_documents", "sap_s4hana"])
    assert len(explorer_tools) > len(doc_tools)
    explorer_names = {t["function"]["name"] for t in explorer_tools}
    assert "workspace_search_documents" in explorer_names
    assert "sap_mm_check_stock_overview" in explorer_names
