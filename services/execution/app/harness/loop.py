"""Action-Observation Execution Loop & State Machine for OpenHands Harness.

Features:
- Full action-observation state machine (running -> awaiting_approval -> running -> completed/failed/rejected).
- Step progression and Max Steps Guard (terminates with 'failed' status if step count exceeds limit).
- Approval Resumption: Resumes paused session from approval point without duplicate execution.
- Monotonic append-only event stream persistence.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from fastapi import HTTPException

from ..sqlite_adapter import get_connection
from .models import Action, Observation, SessionStatus
from .orchestrator import Orchestrator
from .policy_guard import PolicyGuard
from .stream import EventStreamManager
from .worker import Worker

logger = logging.getLogger("execution.harness.loop")


class ExecutionLoop:
    """Manages the action-observation lifecycle of an AgentSession."""

    def __init__(
        self,
        session_id: str,
        tenant_id: str,
        caller_role: str = "engineer",
        caller_email: str = "system",
    ):
        self.session_id = session_id
        self.tenant_id = tenant_id
        self.caller_role = caller_role
        self.caller_email = caller_email
        self.stream = EventStreamManager(session_id)
        self.policy_guard = PolicyGuard(tenant_id, caller_role, caller_email)
        self.worker = Worker(tenant_id)

    def _get_session(self) -> Dict[str, Any]:
        with get_connection() as c:
            row = c.execute(
                "SELECT id, tenant_id, task, context, status, current_step, max_steps, result, created_at, updated_at "
                "FROM agent_sessions WHERE id=%s AND tenant_id=%s",
                (self.session_id, self.tenant_id),
            ).fetchone()
            if not row:
                raise HTTPException(404, f"Agent session not found: {self.session_id}")
            if isinstance(row.get("context"), str):
                try:
                    row["context"] = json.loads(row["context"])
                except Exception:
                    row["context"] = {}
            if isinstance(row.get("result"), str):
                try:
                    row["result"] = json.loads(row["result"])
                except Exception:
                    pass
            return row

    def _update_session(
        self,
        status: Optional[str] = None,
        current_step: Optional[int] = None,
        result: Optional[Dict[str, Any]] = None,
    ):
        with get_connection() as c:
            updates, params = [], []
            if status is not None:
                updates.append("status=%s")
                params.append(status)
            if current_step is not None:
                updates.append("current_step=%s")
                params.append(current_step)
            if result is not None:
                updates.append("result=%s")
                params.append(json.dumps(result))
            updates.append("updated_at=CURRENT_TIMESTAMP")
            params.extend([self.session_id, self.tenant_id])
            c.execute(f"UPDATE agent_sessions SET {', '.join(updates)} WHERE id=%s AND tenant_id=%s", params)
            c.commit()

    def _find_pending_approval_action(self) -> Optional[Dict[str, Any]]:
        """Finds the most recent unapproved approval_request action in the event stream."""
        events = self.stream.get_events()
        for ev in reversed(events):
            ev_type = ev.get("event_type") if hasattr(ev, "get") else getattr(ev, "type", None)
            ev_name = ev.get("name") if hasattr(ev, "get") else getattr(ev, "name", None)
            if ev_type in ("action", "Action") and ev_name == "approval_request":
                return ev.get("payload") if hasattr(ev, "get") else getattr(ev, "payload", {})
        return None

    def run(self, is_approved: bool = False) -> Dict[str, Any]:
        """Executes the action-observation loop until completion, approval pause, or step limit."""
        session = self._get_session()
        current_status = session["status"]
        current_step = session["current_step"] or 0
        max_steps = session["max_steps"] or 10
        task = session["task"]
        context = session.get("context", {}) or {}

        # 1. Terminal state check
        if current_status in ("completed", "failed", "rejected"):
            return {
                "session_id": self.session_id,
                "status": current_status,
                "current_step": current_step,
                "step_count": current_step,
                "result": session.get("result"),
            }

        # 2. Fresh session initialization
        if current_step == 0 and current_status == "running":
            self.stream.append_action("session_start", {"task": task, "context": context, "max_steps": max_steps})
            self.stream.append_observation("state_changed", {"old_status": None, "new_status": "running", "step": 0})

        # 3. Approval resumption handling
        if current_status == "awaiting_approval":
            if not is_approved:
                # Remains paused awaiting approval
                return {
                    "session_id": self.session_id,
                    "status": "awaiting_approval",
                    "current_step": current_step,
                    "step_count": current_step,
                }

            # Resuming from approved state
            self.stream.append_observation(
                "policy",
                {"decision": "approved", "actor": self.caller_email, "role": self.caller_role, "step": current_step},
            )
            self.stream.append_observation(
                "state_changed",
                {"old_status": "awaiting_approval", "new_status": "running", "step": current_step},
            )
            self._update_session(status="running")

            # Execute the paused tool call that was pending approval
            pending_req = self._find_pending_approval_action()
            if pending_req:
                tool_name = pending_req.get("tool") or pending_req.get("tool_name")
                tool_params = pending_req.get("params") or pending_req.get("arguments", {})
                check_res, tool_obj = self.policy_guard.check_tool_call(
                    tool_name=tool_name,
                    params=tool_params,
                    session_id=self.session_id,
                    step=current_step,
                    is_approved=True,
                )
                if check_res.policy_observation:
                    self.stream.append_observation(check_res.policy_observation.name, check_res.policy_observation.payload)
                if check_res.observation:
                    self.stream.append_observation(check_res.observation.name, check_res.observation.payload)

                if check_res.allowed and tool_obj:
                    obs = self.policy_guard.execute_tool(tool_obj, tool_params, self.session_id, current_step)
                    self.stream.append_observation(obs.name, obs.payload)

        # 4. Fetch available tools for tenant
        with get_connection() as c:
            tools = c.execute(
                "SELECT name, description, input_schema, connector, risk FROM tools WHERE tenant_id=%s ORDER BY name",
                (self.tenant_id,),
            ).fetchall()

        orchestrator = Orchestrator(self.tenant_id, tools)

        # 5. Execution Loop
        while current_step < max_steps:
            current_step += 1
            self._update_session(current_step=current_step)

            # Max steps guard check
            if current_step > max_steps:
                self.stream.append_observation(
                    "error",
                    {"error": f"Max steps guard triggered: exceeded {max_steps} steps", "step": current_step},
                )
                self.stream.append_observation(
                    "state_changed",
                    {"old_status": "running", "new_status": "failed", "step": current_step},
                )
                self._update_session(status="failed", result={"error": f"Exceeded max_steps limit of {max_steps}"})
                return {
                    "session_id": self.session_id,
                    "status": "failed",
                    "current_step": current_step,
                    "step_count": current_step,
                    "result": {"error": f"Exceeded max_steps limit of {max_steps}"},
                }

            # Retrieve event history
            history = self.stream.get_events()

            # Orchestrator decides next action
            action = orchestrator.step(
                task=task,
                context=context,
                history=history,
                step_num=current_step,
            )

            # Record action in event stream
            self.stream.append_action(action.name, action.payload)

            # Dispatch action
            if action.name == "plan":
                self.stream.append_observation(
                    "state_changed",
                    {"plan_acknowledged": True, "step": current_step},
                )
                continue

            elif action.name == "tool_call":
                tool_name = action.payload.get("tool") or action.payload.get("tool_name")
                params = action.payload.get("params") or action.payload.get("arguments", {})

                check_res, tool_obj = self.policy_guard.check_tool_call(
                    tool_name=tool_name,
                    params=params,
                    session_id=self.session_id,
                    step=current_step,
                    is_approved=is_approved,
                )

                if check_res.policy_observation:
                    self.stream.append_observation(check_res.policy_observation.name, check_res.policy_observation.payload)

                if check_res.status == "needs_approval":
                    if check_res.action:
                        self.stream.append_action(check_res.action.name, check_res.action.payload)
                    self.stream.append_observation(
                        "state_changed",
                        {"old_status": "running", "new_status": "awaiting_approval", "step": current_step},
                    )
                    self._update_session(status="awaiting_approval", current_step=current_step)
                    return {
                        "session_id": self.session_id,
                        "status": "awaiting_approval",
                        "current_step": current_step,
                        "step_count": current_step,
                    }

                elif check_res.status == "deny":
                    if check_res.observation:
                        self.stream.append_observation(check_res.observation.name, check_res.observation.payload)
                    self.stream.append_observation(
                        "state_changed",
                        {"old_status": "running", "new_status": "failed", "step": current_step},
                    )
                    self._update_session(
                        status="failed",
                        current_step=current_step,
                        result={"error": f"Policy denied tool '{tool_name}': {check_res.reason}"},
                    )
                    return {
                        "session_id": self.session_id,
                        "status": "failed",
                        "current_step": current_step,
                        "step_count": current_step,
                        "result": {"error": f"Policy denied tool '{tool_name}': {check_res.reason}"},
                    }

                elif check_res.status == "allow" and tool_obj:
                    obs = self.policy_guard.execute_tool(tool_obj, params, self.session_id, current_step)
                    self.stream.append_observation(obs.name, obs.payload)
                    continue

            elif action.name == "delegate":
                worker_type = action.payload.get("worker_type", "extract")
                subtask = action.payload.get("task", "")
                input_data = action.payload.get("input_data", {})

                obs = self.worker.execute_delegation(worker_type, subtask, input_data, current_step)
                self.stream.append_observation(obs.name, obs.payload)
                continue

            elif action.name == "agent_finish":
                result_payload = action.payload
                self.stream.append_observation(
                    "state_changed",
                    {"old_status": "running", "new_status": "completed", "step": current_step},
                )
                self._update_session(
                    status="completed",
                    current_step=current_step,
                    result=result_payload,
                )
                return {
                    "session_id": self.session_id,
                    "status": "completed",
                    "current_step": current_step,
                    "step_count": current_step,
                    "result": result_payload,
                }

        # 6. Post-loop max steps exhaustion
        final_sess = self._get_session()
        if final_sess["status"] == "running":
            self.stream.append_observation(
                "error",
                {"error": f"Max steps guard triggered: reached step limit {max_steps} without agent finish", "step": current_step},
            )
            self.stream.append_observation(
                "state_changed",
                {"old_status": "running", "new_status": "failed", "step": current_step},
            )
            self._update_session(status="failed", result={"error": f"Exceeded max_steps limit of {max_steps}"})
            return {
                "session_id": self.session_id,
                "status": "failed",
                "current_step": current_step,
                "step_count": current_step,
                "result": {"error": f"Exceeded max_steps limit of {max_steps}"},
            }

        return {
            "session_id": self.session_id,
            "status": final_sess["status"],
            "current_step": final_sess["current_step"],
            "step_count": final_sess["current_step"],
            "result": final_sess.get("result"),
        }


def run_session_loop(
    session_id: str,
    tenant_id: str,
    caller_role: str = "engineer",
    caller_email: str = "system",
    is_approved: bool = False,
) -> Dict[str, Any]:
    """Helper entry point for running the execution loop."""
    loop = ExecutionLoop(
        session_id=session_id,
        tenant_id=tenant_id,
        caller_role=caller_role,
        caller_email=caller_email,
    )
    return loop.run(is_approved=is_approved)
