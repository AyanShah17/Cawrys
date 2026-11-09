import json
import os
import uuid

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import auth_routes, ingest, models, storage, validate
from .auth import Ctx, current, require
from .config import MODEL_EXTRACT, MODEL_REASON, MODEL_VISION
from .db import audit, conn


@asynccontextmanager
async def lifespan(_app):
    if os.environ.get("SEED_DEMO", "1") == "1":
        try:
            auth_routes.seed_demo_users()
        except Exception as e:  # DB may still be starting; the API keeps serving
            print(f"demo user seed skipped: {e}")
    yield


app = FastAPI(title="Cawrys Intelligence Service", version="0.3.0", lifespan=lifespan)
# Browsers reach the services through the web app's server-side proxy, so cross-origin access is not needed.
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("CORS_ORIGINS", "").split(",") if os.environ.get("CORS_ORIGINS") else [], allow_methods=["*"], allow_headers=["*"])
app.include_router(auth_routes.router)


@app.get("/health")
def health():
    return {"ok": True, "service": "intelligence"}


@app.post("/v1/documents")
async def process_document(file: UploadFile = File(...), ctx: Ctx = Depends(require("admin", "engineer"))):
    tenant_id = ctx.tenant_id
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    mime = file.content_type or "application/octet-stream"
    filename = os.path.basename((file.filename or "upload").replace("\\", "/")) or "upload"
    k = ingest.kind(mime, filename)
    doc_id = str(uuid.uuid4())
    key = f"{tenant_id}/{doc_id}/{filename}"

    try:
        storage.put(key, data, mime)
    except Exception as e:  # storage optional in local dev
        key = f"local-unstored/{doc_id}"
        storage_error = str(e)
    else:
        storage_error = None

    with conn() as c:
        c.execute(
            "insert into documents (id, tenant_id, filename, mime_type, storage_key, status) "
            "values (%s,%s,%s,%s,%s,'extracting')",
            (doc_id, tenant_id, filename, mime, key),
        )
        audit(c, tenant_id, "document.received", doc_id, {"kind": k, "storage_error": storage_error}, actor=ctx.email)
        c.commit()

    trace = []
    try:
        # Tier 1: specialist extraction
        if k == "image":
            extracted, t = models.extract_image(MODEL_VISION, data, mime)
        else:
            extracted, t = models.extract_text(MODEL_EXTRACT, ingest.to_text(k, data))
        trace.append(t)

        fields = extracted.get("fields", {})
        # Tier 3 (before reasoning): deterministic validation
        validation = validate.validate(
            fields, extracted.get("field_confidence", {}), extracted.get("missing", [])
        )

        # Tier 2: reasoning model only when there is something to decide on
        decision = {}
        if fields:
            decision, t2 = models.reason(MODEL_REASON, extracted.get("doc_type", "unknown"), fields, validation)
            trace.append(t2)

        needs_review = validation["needs_review"] or any(
            a.get("risk") == "high" for a in decision.get("proposed_actions", [])
        )
        status = "needs_review" if needs_review else "ready"
        ext_id = str(uuid.uuid4())
        with conn() as c:
            c.execute(
                "insert into extractions (id, document_id, tenant_id, doc_type, fields, confidence, validation, decision, requires_approval, model_trace) "
                "values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (ext_id, doc_id, tenant_id, extracted.get("doc_type"), json.dumps(fields),
                 validation["overall_confidence"], json.dumps(validation), json.dumps(decision), True, json.dumps(trace)),
            )
            c.execute("update documents set status=%s where id=%s", (status, doc_id))
            audit(c, tenant_id, "document.processed", doc_id, {"status": status, "extraction_id": ext_id}, actor=ctx.email)
            c.commit()
        return {"document_id": doc_id, "extraction_id": ext_id, "status": status,
                "doc_type": extracted.get("doc_type"), "fields": fields,
                "validation": validation, "decision": decision}
    except Exception as e:
        with conn() as c:
            c.execute("update documents set status='failed' where id=%s", (doc_id,))
            audit(c, tenant_id, "document.failed", doc_id, {"error": str(e)}, actor=ctx.email)
            c.commit()
        raise HTTPException(502, f"processing failed: {e}")


@app.get("/v1/documents")
def list_documents(limit: int = 50, ctx: Ctx = Depends(current)):
    tenant_id = ctx.tenant_id
    limit = max(1, min(limit, 200))
    with conn() as c:
        rows = c.execute(
            "select d.id, d.filename, d.status, d.created_at, e.doc_type, e.confidence "
            "from documents d left join extractions e on e.document_id=d.id "
            "where d.tenant_id=%s order by d.created_at desc limit %s",
            (tenant_id, limit),
        ).fetchall()
    return rows


@app.get("/v1/documents/{doc_id}")
def get_document(doc_id: str, ctx: Ctx = Depends(current)):
    try:
        uuid.UUID(doc_id)
    except ValueError:
        raise HTTPException(404, "not found")
    with conn() as c:
        row = c.execute(
            "select d.*, e.id as extraction_id, e.doc_type, e.fields, e.confidence, e.validation, e.decision "
            "from documents d left join extractions e on e.document_id=d.id where d.id=%s and d.tenant_id=%s",
            (doc_id, ctx.tenant_id),
        ).fetchone()
    if not row:
        raise HTTPException(404, "not found")
    return row


@app.get("/v1/audit")
def get_audit(limit: int = 100, ctx: Ctx = Depends(current)):
    tenant_id = ctx.tenant_id
    limit = max(1, min(limit, 500))
    with conn() as c:
        return c.execute(
            "select * from audit_log where tenant_id=%s order by created_at desc limit %s",
            (tenant_id, limit),
        ).fetchall()
