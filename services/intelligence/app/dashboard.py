"""Read-only data for the dashboard: summary metrics, system status, and AI connection diagnostics."""
import datetime
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
from fastapi import APIRouter, Depends

from . import models
from .auth import Ctx, current, require
from .config import (
    DEFAULT_TENANT,
    LITELLM_BASE_URL,
    MOCK_AI,
    MODEL_EXTRACT,
    MODEL_REASON,
    MODEL_VISION,
    R2_ENDPOINT,
)
from .db import audit, conn
from .sqlite_adapter import is_sqlite

router = APIRouter(prefix="/v1", tags=["dashboard"])

EXECUTION_URL = os.environ.get("EXECUTION_URL", "http://localhost:8002")
EDGE_URL = os.environ.get("EDGE_URL", "http://localhost:8080")
ENV = os.environ.get("ENVIRONMENT", os.environ.get("ENV", "development"))
BRAND_NAME = os.environ.get("BRAND_NAME", "Cawrys")
VERSION = os.environ.get("VERSION", "0.3.0")
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "50"))


@router.get("/dashboard/summary")
def summary(days: int = 14, ctx: Ctx = Depends(current)):
    days = max(1, min(days, 90))
    tid = ctx.tenant_id

    with conn() as c:
        # 1. Document count by status
        by_status = {
            r["status"]: r["n"]
            for r in c.execute(
                "select status, count(*)::int as n from documents where tenant_id=%s group by status", (tid,)
            ).fetchall()
        }

        # 2. Time-series per day and AI metrics
        if is_sqlite():
            # SQLite Implementation: Pure Python aggregation for series generation and JSON parsing
            today = datetime.datetime.now(datetime.timezone.utc).date()
            day_strs = [(today - datetime.timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days - 1, -1, -1)]

            day_counts = {}
            for r in c.execute(
                "select strftime('%Y-%m-%d', created_at) as day, status, count(*) as n "
                "from documents where tenant_id=%s and created_at >= datetime('now', '-' || %s || ' days') "
                "group by strftime('%Y-%m-%d', created_at), status",
                (tid, days),
            ).fetchall():
                d = r["day"]
                if d not in day_counts:
                    day_counts[d] = {}
                day_counts[d][r["status"]] = r["n"]

            per_day = [
                {
                    "day": d,
                    "ready": day_counts.get(d, {}).get("ready", 0),
                    "needs_review": day_counts.get(d, {}).get("needs_review", 0),
                    "failed": day_counts.get(d, {}).get("failed", 0),
                }
                for d in day_strs
            ]

            # AI token consumption aggregated from model_trace
            model_stats = {}
            for r in c.execute(
                "select model_trace from extractions where tenant_id=%s and created_at >= datetime('now', '-' || %s || ' days')",
                (tid, days),
            ).fetchall():
                raw = r.get("model_trace")
                traces = json.loads(raw) if isinstance(raw, str) else (raw or [])
                for t in traces:
                    if not isinstance(t, dict):
                        continue
                    m = t.get("model") or "unknown"
                    if m not in model_stats:
                        model_stats[m] = {
                            "model": m,
                            "calls": 0,
                            "prompt_tokens": 0,
                            "completion_tokens": 0,
                            "tokens": 0,
                            "_lat_sum": 0,
                            "_lat_count": 0,
                        }
                    s = model_stats[m]
                    s["calls"] += 1
                    s["prompt_tokens"] += int(t.get("prompt_tokens") or 0)
                    s["completion_tokens"] += int(t.get("completion_tokens") or 0)
                    s["tokens"] += int(t.get("tokens") or 0)
                    if t.get("latency_ms") is not None:
                        s["_lat_sum"] += t["latency_ms"]
                        s["_lat_count"] += 1

            ai = []
            for m, s in model_stats.items():
                avg_lat = int(s["_lat_sum"] / s["_lat_count"]) if s["_lat_count"] > 0 else 0
                ai.append({
                    "model": m,
                    "calls": s["calls"],
                    "prompt_tokens": s["prompt_tokens"],
                    "completion_tokens": s["completion_tokens"],
                    "tokens": s["tokens"],
                    "avg_latency_ms": avg_lat,
                })
            ai.sort(key=lambda x: x["tokens"], reverse=True)

            conf_row = c.execute(
                "select avg(confidence) as v from extractions where tenant_id=%s and created_at >= datetime('now', '-' || %s || ' days')",
                (tid, days),
            ).fetchone()
            conf = float(conf_row["v"]) if conf_row and conf_row["v"] is not None else None

        else:
            # PostgreSQL Implementation: Native generate_series and jsonb_array_elements
            per_day = c.execute(
                """
                select to_char(g.d, 'YYYY-MM-DD') as day,
                       count(x.id) filter (where x.status = 'ready')::int as ready,
                       count(x.id) filter (where x.status = 'needs_review')::int as needs_review,
                       count(x.id) filter (where x.status = 'failed')::int as failed
                from generate_series((current_date - (%s::int - 1))::timestamp, current_date::timestamp, interval '1 day') as g(d)
                left join documents x on x.tenant_id = %s and x.created_at::date = g.d::date
                group by g.d order by g.d
                """,
                (days, tid),
            ).fetchall()

            ai = c.execute(
                """
                select t->>'model' as model,
                       count(*)::int as calls,
                       coalesce(sum((t->>'prompt_tokens')::bigint), 0)::bigint as prompt_tokens,
                       coalesce(sum((t->>'completion_tokens')::bigint), 0)::bigint as completion_tokens,
                       coalesce(sum((t->>'tokens')::bigint), 0)::bigint as tokens,
                       coalesce(avg((t->>'latency_ms')::numeric), 0)::int as avg_latency_ms
                from extractions e cross join lateral jsonb_array_elements(e.model_trace) as t
                where e.tenant_id = %s and e.created_at >= now() - make_interval(days => %s::int)
                group by 1 order by 5 desc
                """,
                (tid, days),
            ).fetchall()

            conf = c.execute(
                "select avg(confidence)::float as v from extractions "
                "where tenant_id=%s and created_at >= now() - make_interval(days => %s::int)",
                (tid, days),
            ).fetchone()["v"]

        # 3. Recent documents and audit logs (dialect-neutral)
        recent_docs = c.execute(
            "select d.id::text as id, d.filename, d.status, d.created_at, e.doc_type, e.confidence "
            "from documents d left join extractions e on e.document_id = d.id "
            "where d.tenant_id=%s order by d.created_at desc limit 8",
            (tid,),
        ).fetchall()
        for d in recent_docs:
            d["id"] = str(d["id"])
            if d.get("confidence") is not None:
                d["confidence"] = float(d["confidence"])

        recent_audit = c.execute(
            "select id, actor, service, event, created_at from audit_log where tenant_id=%s order by id desc limit 10",
            (tid,),
        ).fetchall()
        for a in recent_audit:
            a["id"] = int(a["id"])

    return {
        "days": days,
        "documents": {"total": sum(by_status.values()), "by_status": by_status, "per_day": per_day},
        "ai": {
            "by_model": ai,
            "total_tokens": sum(int(r["tokens"]) for r in ai),
            "total_calls": sum(r["calls"] for r in ai),
        },
        "avg_confidence": conf,
        "recent_documents": recent_docs,
        "recent_audit": recent_audit,
    }


def _probe(name: str, url: str) -> dict:
    t0 = time.perf_counter()
    try:
        r = httpx.get(url, timeout=3)
        ok = r.status_code == 200
        detail = "" if ok else f"HTTP {r.status_code}"
    except Exception:
        ok, detail = False, "unreachable"
    return {"name": name, "ok": ok, "latency_ms": int((time.perf_counter() - t0) * 1000), "detail": detail}


def _probe_db() -> dict:
    t0 = time.perf_counter()
    try:
        with conn() as c:
            c.execute("select 1")
        ok, detail = True, ""
    except Exception:
        ok, detail = False, "unreachable"
    return {"name": "Database", "ok": ok, "latency_ms": int((time.perf_counter() - t0) * 1000), "detail": detail}


@router.get("/system/status")
def system_status(ctx: Ctx = Depends(current)):
    probes = {
        "Execution API": f"{EXECUTION_URL.rstrip('/')}/health/ready" if EXECUTION_URL else None,
        "Edge ingest": f"{EDGE_URL.rstrip('/')}/health" if EDGE_URL else None,
        "AI gateway": None if MOCK_AI else f"{LITELLM_BASE_URL.rstrip('/')}/health/liveliness",
    }
    results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=5) as ex:
        futs = {n: ex.submit(_probe, n, u) for n, u in probes.items() if u}
        db = ex.submit(_probe_db)
        for n, f in futs.items():
            results[n] = f.result()
        results["Database"] = db.result()

    if MOCK_AI:
        results["AI gateway"] = {
            "name": "AI gateway",
            "ok": True,
            "latency_ms": 0,
            "detail": "demo mode (no AI provider)",
        }

    order = ["Intelligence API", "Execution API", "Edge ingest", "AI gateway", "Database"]
    services = [{"name": "Intelligence API", "ok": True, "latency_ms": 0, "detail": ""}] + [
        results[n] for n in order[1:] if n in results
    ]

    out = {
        "ok": all(s["ok"] for s in services),
        "services": services,
        "version": VERSION,
        "env": ENV,
        "storage": "object storage" if R2_ENDPOINT else "local disk",
        "demo_mode": MOCK_AI,
    }
    if ctx.role == "admin":
        out["config"] = {
            "brand": BRAND_NAME,
            "ai_roles": {"extraction": MODEL_EXTRACT, "vision": MODEL_VISION, "reasoning": MODEL_REASON},
            "max_upload_mb": MAX_UPLOAD_MB,
        }
    return out


@router.post("/system/ai-test")
def ai_test(ctx: Ctx = Depends(require("admin"))):
    t0 = time.perf_counter()
    try:
        if hasattr(models, "ping"):
            _, trace = models.ping(MODEL_EXTRACT)
            lat = trace.get("latency_ms", int((time.perf_counter() - t0) * 1000))
            tok = trace.get("tokens", 10)
        elif MOCK_AI:
            lat = 1
            tok = 10
        else:
            _, trace = models.extract_text(MODEL_EXTRACT, "Drawing ID: DWG-1\nMaterial: Steel")
            lat = int((time.perf_counter() - t0) * 1000)
            tok = trace.get("tokens") or 10
        result = {"ok": True, "latency_ms": lat, "tokens": tok, "demo_mode": MOCK_AI}
    except Exception as e:
        result = {"ok": False, "error": str(e), "demo_mode": MOCK_AI}

    with conn() as c:
        audit(c, ctx.tenant_id, "ai.connection_test", detail={"ok": result["ok"]}, actor=ctx.email)
        c.commit()
    return result
