import json
import os
import uuid

import jsonschema
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import connectors, policy
from .auth import Ctx, current, require
from .harness.routes import router as harness_router
from .sqlite_adapter import get_connection

DATABASE_URL = os.environ.get("NEON_DATABASE_URL") or os.environ.get("DATABASE_URL") or ""


def conn():
    return get_connection()


def audit(c, tenant_id, event, workflow_id=None, detail=None, actor="system"):
    c.execute(
        "insert into audit_log (tenant_id, actor, service, event, workflow_id, detail) values (%s,%s,'execution',%s,%s,%s)",
        (tenant_id, actor, event, workflow_id, json.dumps(detail or {})),
    )


DEMO_TOOLS = [
    {"name": "erp_lookup_inventory", "description": "Check material availability in the ERP",
     "input_schema": {"type": "object", "required": ["material"], "properties": {"material": {"type": "string"}}},
     "connector": "log", "risk": "low"},
    {"name": "schedule_production", "description": "Create a production order in the MES",
     "input_schema": {"type": "object", "required": ["drawing_id", "quantity"],
                      "properties": {"drawing_id": {"type": ["string", "number"]}, "quantity": {"type": "number"}}},
     "connector": "log", "risk": "medium"},
    {"name": "notify_team", "description": "Notify the production team",
     "input_schema": {"type": "object", "required": ["message"], "properties": {"message": {"type": "string"}}},
     "connector": "log", "risk": "low"},
]
DEMO_PLAYBOOK = {
    "name": "production-setup",
    "steps": [
        {"tool": "erp_lookup_inventory", "params": {"material": "$inputs.material"}},
        {"tool": "schedule_production", "params": {"drawing_id": "$inputs.drawing_id", "quantity": "$inputs.quantity"}},
        {"tool": "notify_team", "params": {"message": "Production order scheduled for $inputs.drawing_id"}},
    ],
}


def ensure_seeded(c, tenant_id: str):
    """Give each tenant the demo tools and playbook on first use (SEED_DEMO=0 turns this off)."""
    if os.environ.get("SEED_DEMO", "1") != "1":
        return
    if c.execute("select 1 from tools where tenant_id=%s limit 1", (tenant_id,)).fetchone():
        return
    for t in DEMO_TOOLS:
        c.execute(
            "insert into tools (tenant_id,name,description,input_schema,connector,risk) values (%s,%s,%s,%s,%s,%s)",
            (tenant_id, t["name"], t["description"], json.dumps(t["input_schema"]), t["connector"], t["risk"]),
        )
    if not c.execute("select 1 from playbooks where tenant_id=%s limit 1", (tenant_id,)).fetchone():
        c.execute(
            "insert into playbooks (tenant_id,name,version,steps) values (%s,%s,1,%s)",
            (tenant_id, DEMO_PLAYBOOK["name"], json.dumps(DEMO_PLAYBOOK["steps"])),
        )
    audit(c, tenant_id, "demo.seeded")
    c.commit()


app = FastAPI(title="Cawrys Execution Service", version="0.3.0")
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("CORS_ORIGINS", "").split(",") if os.environ.get("CORS_ORIGINS") else [], allow_methods=["*"], allow_headers=["*"])
app.include_router(harness_router, prefix="/v1/agent", tags=["agent"])


class ToolIn(BaseModel):
    name: str
    description: str | None = None
    input_schema: dict
    connector: str = "log"
    secret_ref: str | None = None
    risk: str = "medium"


class PlaybookIn(BaseModel):
    name: str
    steps: list[dict]  # [{tool: str, params: {...}}]


class RunIn(BaseModel):
    playbook: str
    inputs: dict = {}
    extraction_id: str | None = None


@app.get("/health")
def health():
    return {"ok": True, "service": "execution"}


@app.post("/v1/tools")
def register_tool(t: ToolIn, ctx: Ctx = Depends(require("admin", "engineer"))):
    tenant_id = ctx.tenant_id
    jsonschema.Draft202012Validator.check_schema(t.input_schema)
    with conn() as c:
        c.execute(
            "insert into tools (tenant_id,name,description,input_schema,connector,secret_ref,risk) "
            "values (%s,%s,%s,%s,%s,%s,%s) on conflict (tenant_id,name) do update set "
            "description=excluded.description, input_schema=excluded.input_schema, connector=excluded.connector, "
            "secret_ref=excluded.secret_ref, risk=excluded.risk",
            (tenant_id, t.name, t.description, json.dumps(t.input_schema), t.connector, t.secret_ref, t.risk),
        )
        audit(c, tenant_id, "tool.registered", detail={"name": t.name})
        c.commit()
    return {"ok": True}


@app.get("/v1/tools")
def list_tools(ctx: Ctx = Depends(current)):
    tenant_id = ctx.tenant_id
    with conn() as c:
        ensure_seeded(c, tenant_id)
        return c.execute(
            "select name, description, input_schema, connector, risk from tools where tenant_id=%s order by name",
            (tenant_id,),
        ).fetchall()


@app.post("/v1/playbooks")
def save_playbook(p: PlaybookIn, ctx: Ctx = Depends(require("admin", "engineer"))):
    tenant_id = ctx.tenant_id
    with conn() as c:
        row = c.execute(
            "select coalesce(max(version),0)+1 as v from playbooks where tenant_id=%s and name=%s", (tenant_id, p.name)
        ).fetchone()
        c.execute(
            "insert into playbooks (tenant_id,name,version,steps) values (%s,%s,%s,%s)",
            (tenant_id, p.name, row["v"], json.dumps(p.steps)),
        )
        audit(c, tenant_id, "playbook.saved", detail={"name": p.name, "version": row["v"]})
        c.commit()
    return {"name": p.name, "version": row["v"]}


@app.get("/v1/playbooks")
def list_playbooks(ctx: Ctx = Depends(current)):
    tenant_id = ctx.tenant_id
    with conn() as c:
        ensure_seeded(c, tenant_id)
        return c.execute(
            "select distinct on (name) name, version, steps from playbooks where tenant_id=%s order by name, version desc",
            (tenant_id,),
        ).fetchall()


def _render(value, inputs: dict):
    if isinstance(value, dict):
        return {k: _render(v, inputs) for k, v in value.items()}
    if isinstance(value, str):
        if value.startswith("$inputs.") and value.count("$inputs.") == 1 and " " not in value:
            return inputs.get(value[len("$inputs."):])
        out = value
        for k, v in inputs.items():
            out = out.replace(f"$inputs.{k}", str(v))
        return out
    return value


def _run_steps(c, tenant_id, exec_id, steps, inputs, role, approved, done=None):
    """Run steps from where a prior run stopped, so approved runs never repeat executed steps."""
    results = list(done or [])
    for i in range(len(results), len(steps)):
        step = steps[i]
        tool = c.execute("select * from tools where tenant_id=%s and name=%s", (tenant_id, step["tool"])).fetchone()
        if not tool:
            raise HTTPException(400, f"unknown tool: {step['tool']}")
        params = _render(step.get("params", {}), inputs)
        try:
            jsonschema.validate(params, tool["input_schema"])
        except jsonschema.ValidationError as e:
            raise HTTPException(422, f"step {i} ({tool['name']}) invalid input: {e.message}")
        decision, reason = policy.decide(tool, role, approved)
        audit(c, tenant_id, f"policy.{decision}", exec_id, {"step": i, "tool": tool["name"], "reason": reason}, actor=role)
        if decision == "deny":
            return "rejected", results, reason
        if decision == "needs_approval":
            return "awaiting_approval", results, reason
        out = connectors.get(tool["connector"]).execute(tool["connector"], tool["secret_ref"], params)
        audit(c, tenant_id, "tool.executed", exec_id, {"step": i, "tool": tool["name"]}, actor=role)
        results.append({"step": i, "tool": tool["name"], "result": out})
    return "succeeded", results, "ok"


@app.post("/v1/executions")
def run(req: RunIn, ctx: Ctx = Depends(current)):
    tenant_id, role = ctx.tenant_id, ctx.role
    with conn() as c:
        ensure_seeded(c, tenant_id)
        pb = c.execute(
            "select * from playbooks where tenant_id=%s and name=%s order by version desc limit 1",
            (tenant_id, req.playbook),
        ).fetchone()
        if not pb:
            raise HTTPException(404, "playbook not found")
        inputs = {}
        if req.extraction_id:
            ex = c.execute(
                "select fields from extractions where id=%s and tenant_id=%s", (req.extraction_id, tenant_id)
            ).fetchone()
            if not ex:
                raise HTTPException(404, "extraction not found")
            fields = ex["fields"] or {}
            inputs.update(fields)
            if not inputs.get("material"):
                inputs["material"] = "Standard Specification"
            if not inputs.get("drawing_id"):
                inputs["drawing_id"] = f"DOC-{req.extraction_id[:8].upper()}"
            if not isinstance(inputs.get("quantity"), (int, float)):
                inputs["quantity"] = 1
        inputs.update(req.inputs)
        exec_id = str(uuid.uuid4())
        status, results, reason = _run_steps(c, tenant_id, exec_id, pb["steps"], inputs, role, False)
        c.execute(
            "insert into executions (id,tenant_id,playbook_id,extraction_id,status,result) values (%s,%s,%s,%s,%s,%s)",
            (exec_id, tenant_id, pb["id"], req.extraction_id, status,
             json.dumps({"results": results, "reason": reason, "inputs": inputs, "playbook": req.playbook})),
        )
        audit(c, tenant_id, f"execution.{status}", exec_id, {"playbook": req.playbook, "role": role}, actor=ctx.email)
        c.commit()
    return {"execution_id": exec_id, "status": status, "reason": reason, "results": results}


def _load_pending(c, exec_id, tenant_id):
    ex = c.execute("select * from executions where id=%s and tenant_id=%s", (exec_id, tenant_id)).fetchone()
    if not ex or ex["status"] != "awaiting_approval":
        raise HTTPException(409, "not awaiting approval")
    return ex


@app.post("/v1/executions/{exec_id}/approve")
def approve(exec_id: str, ctx: Ctx = Depends(require("admin", "approver"))):
    tenant_id, role = ctx.tenant_id, ctx.role
    with conn() as c:
        ex = _load_pending(c, exec_id, tenant_id)
        pb = c.execute("select * from playbooks where id=%s", (ex["playbook_id"],)).fetchone()
        prior = ex["result"]
        status, results, reason = _run_steps(
            c, tenant_id, exec_id, pb["steps"], prior.get("inputs", {}), role, True, prior.get("results", [])
        )
        c.execute(
            "update executions set status=%s, result=%s, approved_by=%s where id=%s",
            (status, json.dumps({**prior, "results": results, "reason": reason}), ctx.user_id, exec_id),
        )
        audit(c, tenant_id, f"execution.approved.{status}", exec_id, {"role": role}, actor=ctx.email)
        c.commit()
    return {"execution_id": exec_id, "status": status, "results": results}


@app.post("/v1/executions/{exec_id}/reject")
def reject(exec_id: str, ctx: Ctx = Depends(require("admin", "approver"))):
    tenant_id, role = ctx.tenant_id, ctx.role
    with conn() as c:
        ex = _load_pending(c, exec_id, tenant_id)
        c.execute(
            "update executions set status='rejected', result=%s where id=%s",
            (json.dumps({**ex["result"], "reason": f"rejected by {role}"}), exec_id),
        )
        audit(c, tenant_id, "execution.rejected", exec_id, {"role": role}, actor=ctx.email)
        c.commit()
    return {"execution_id": exec_id, "status": "rejected"}


@app.get("/v1/executions")
def list_exec(limit: int = 50, ctx: Ctx = Depends(current)):
    tenant_id = ctx.tenant_id
    limit = max(1, min(limit, 200))
    with conn() as c:
        return c.execute(
            "select id, status, extraction_id, created_at, result from executions "
            "where tenant_id=%s order by created_at desc limit %s",
            (tenant_id, limit),
        ).fetchall()
