"""OpenHands Agent Execution Harness REST & SSE Streaming Routes.

Provides endpoints for creating agent sessions, retrieving session status and
event history, real-time SSE streaming, and human-in-the-loop approval/rejection.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from ..auth import Ctx, current, require
from ..sqlite_adapter import get_connection
from .loop import run_session_loop
from .models import (
    ApproveSessionRequest,
    CreateSessionRequest,
    ObservationType,
    RejectSessionRequest,
    SessionResponse,
    SessionStatus,
)
from .stream import event_stream

logger = logging.getLogger("execution.harness.routes")
router = APIRouter()


def audit(
    c,
    tenant_id: str,
    event: str,
    workflow_id: Optional[str] = None,
    detail: Optional[Dict[str, Any]] = None,
    actor: str = "system",
):
    """Write an audit entry into audit_log table."""
    c.execute(
        "insert into audit_log (tenant_id, actor, service, event, workflow_id, detail) "
        "values (%s, %s, 'execution', %s, %s, %s)",
        (tenant_id, actor, event, workflow_id, json.dumps(detail or {})),
    )


def _load_pending_session(c, session_id: str, tenant_id: str) -> Dict[str, Any]:
    """Load a session and assert it is awaiting approval."""
    sess = c.execute(
        "select * from agent_sessions where id=%s and tenant_id=%s",
        (session_id, tenant_id),
    ).fetchone()
    if not sess:
        raise HTTPException(status_code=404, detail="agent session not found")
    if sess["status"] != "awaiting_approval":
        raise HTTPException(
            status_code=409,
            detail=f"session not awaiting approval (current status: {sess['status']})",
        )
    return sess


def ensure_seeded(c, tenant_id: str):
    """Ensure standard tools are seeded for tenant if no tools exist yet."""
    if c.execute("select 1 from tools where tenant_id=%s limit 1", (tenant_id,)).fetchone():
        return
    demo_tools = [
        {"name": "erp_lookup_inventory", "description": "Check material availability in the ERP",
         "input_schema": {"type": "object", "required": ["material"], "properties": {"material": {"type": "string"}}},
         "connector": "log", "risk": "low"},
        {"name": "schedule_production", "description": "Post a production order to the MES",
         "input_schema": {"type": "object", "required": ["drawing_id", "quantity"], "properties": {"drawing_id": {"type": "string"}, "quantity": {"type": "integer"}}},
         "connector": "log", "risk": "medium"},
        {"name": "notify_team", "description": "Send a chat notification to the shift lead",
         "input_schema": {"type": "object", "required": ["message"], "properties": {"message": {"type": "string"}}},
         "connector": "log", "risk": "low"},
    ]
    for t in demo_tools:
        c.execute(
            "insert into tools (tenant_id,name,description,input_schema,connector,risk) values (%s,%s,%s,%s,%s,%s)",
            (tenant_id, t["name"], t["description"], json.dumps(t["input_schema"]), t["connector"], t["risk"]),
        )
    c.commit()


# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------

@router.post("/sessions", response_model=SessionResponse)
def create_session(req: CreateSessionRequest, ctx: Ctx = Depends(current)):
    """Create and start a new agent execution session."""
    tenant_id, role, email = ctx.tenant_id, ctx.role, ctx.email
    session_id = str(uuid.uuid4())
    context_data = req.context or {}
    max_steps = req.max_steps or 10

    with get_connection() as c:
        ensure_seeded(c, tenant_id)
        c.execute(
            "insert into agent_sessions (id, tenant_id, task, context, status, current_step, max_steps, created_at, updated_at) "
            "values (%s, %s, %s, %s, 'running', 0, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            (session_id, tenant_id, req.task, json.dumps(context_data), max_steps),
        )
        audit(
            c,
            tenant_id,
            "agent.session.created",
            workflow_id=session_id,
            detail={"task": req.task, "max_steps": max_steps},
            actor=email,
        )
        c.commit()

    # Execute action-observation loop
    loop_res = run_session_loop(
        session_id=session_id,
        tenant_id=tenant_id,
        caller_role=role,
        caller_email=email,
        is_approved=False,
    )

    return SessionResponse(
        session_id=session_id,
        status=loop_res.get("status", "running"),
        step_count=loop_res.get("current_step", 0),
        current_step=loop_res.get("current_step", 0),
        result=loop_res.get("result"),
    )


@router.get("/sessions/{session_id}")
def get_session(session_id: str, ctx: Ctx = Depends(current)):
    """Retrieve agent session metadata, current state, and event history."""
    tenant_id = ctx.tenant_id
    with get_connection() as c:
        row = c.execute(
            "select id, tenant_id, task, context, status, current_step, max_steps, result, created_at, updated_at "
            "from agent_sessions where id=%s and tenant_id=%s",
            (session_id, tenant_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="agent session not found")

        events_raw = c.execute(
            "select id, session_id, seq, event_type, name, payload, created_at "
            "from agent_events where session_id=%s order by seq asc",
            (session_id,),
        ).fetchall()

        events = []
        for ev in (events_raw or []):
            payload = ev["payload"]
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except Exception:
                    pass
            events.append({
                "id": ev["id"],
                "session_id": ev["session_id"],
                "seq": ev["seq"],
                "event_type": ev["event_type"],
                "type": ev["event_type"],
                "name": ev["name"],
                "payload": payload,
                "created_at": str(ev["created_at"]),
            })

        ctx_val = row["context"]
        if isinstance(ctx_val, str):
            try:
                ctx_val = json.loads(ctx_val)
            except Exception:
                pass

        res_val = row["result"]
        if isinstance(res_val, str):
            try:
                res_val = json.loads(res_val)
            except Exception:
                pass

        return {
            "session_id": row["id"],
            "tenant_id": row["tenant_id"],
            "task": row["task"],
            "context": ctx_val,
            "status": row["status"],
            "current_step": row["current_step"],
            "step_count": row["current_step"],
            "max_steps": row["max_steps"],
            "result": res_val,
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
            "events": events,
        }


@router.get("/sessions/{session_id}/stream")
async def stream_session_events(session_id: str, ctx: Ctx = Depends(current)):
    """SSE streaming endpoint emitting agent actions and observations in monotonic order."""
    tenant_id = ctx.tenant_id
    with get_connection() as c:
        sess = c.execute(
            "select id, status from agent_sessions where id=%s and tenant_id=%s",
            (session_id, tenant_id),
        ).fetchone()
        if not sess:
            raise HTTPException(status_code=404, detail="agent session not found")

    return StreamingResponse(
        event_stream.stream_events(session_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/sessions/{session_id}/approve")
def approve_session(
    session_id: str,
    req: Optional[ApproveSessionRequest] = None,
    ctx: Ctx = Depends(require("admin", "approver")),
):
    """Resume a paused session in awaiting_approval after human authorization."""
    tenant_id, role, email, user_id = ctx.tenant_id, ctx.role, ctx.email, ctx.user_id

    with get_connection() as c:
        _load_pending_session(c, session_id, tenant_id)
        c.execute(
            "update agent_sessions set status='running', updated_at=CURRENT_TIMESTAMP where id=%s",
            (session_id,),
        )
        audit(
            c,
            tenant_id,
            "agent.session.approved",
            workflow_id=session_id,
            detail={"role": role, "approved_by": user_id, "feedback": req.feedback if req else None},
            actor=email,
        )
        c.commit()

    # Resume execution loop with is_approved=True
    run_session_loop(
        session_id=session_id,
        tenant_id=tenant_id,
        caller_role=role,
        caller_email=email,
        is_approved=True,
    )

    with get_connection() as c:
        updated = c.execute("select * from agent_sessions where id=%s", (session_id,)).fetchone()

    res_val = updated["result"]
    if isinstance(res_val, str):
        try:
            res_val = json.loads(res_val)
        except Exception:
            pass

    return {
        "session_id": session_id,
        "status": updated["status"],
        "step_count": updated["current_step"],
        "current_step": updated["current_step"],
        "result": res_val,
    }


@router.post("/sessions/{session_id}/reject")
def reject_session(
    session_id: str,
    req: Optional[RejectSessionRequest] = None,
    ctx: Ctx = Depends(require("admin", "approver")),
):
    """Reject a paused session in awaiting_approval."""
    tenant_id, role, email, user_id = ctx.tenant_id, ctx.role, ctx.email, ctx.user_id
    rejection_reason = (req.reason if req and req.reason else None) or f"rejected by {role} ({email})"

    with get_connection() as c:
        sess = _load_pending_session(c, session_id, tenant_id)
        c.execute(
            "update agent_sessions set status='rejected', result=%s, updated_at=CURRENT_TIMESTAMP where id=%s",
            (json.dumps({"reason": rejection_reason}), session_id),
        )
        audit(
            c,
            tenant_id,
            "agent.session.rejected",
            workflow_id=session_id,
            detail={"role": role, "reason": rejection_reason},
            actor=email,
        )
        c.commit()

    # Emit terminal observation into event stream
    event_stream.emit_state_changed(
        session_id=session_id,
        new_status=SessionStatus.REJECTED,
        current_step=sess.get("current_step", 0),
        max_steps=sess.get("max_steps", 10),
        old_status=SessionStatus.AWAITING_APPROVAL,
        reason=rejection_reason,
    )

    return {
        "session_id": session_id,
        "status": "rejected",
        "reason": rejection_reason,
    }
