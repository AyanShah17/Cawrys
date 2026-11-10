"""Policy guard for OpenHands agent harness.

Interlocks tool executions with Cawrys policy engine (app/policy.py):
- Blocks forbidden connectors ('plc', 'machine_direct') immediately with error observation.
- Evaluates role permissions ('viewer' denied, 'high' risk requires 'admin'/'approver').
- For 'medium' and 'high' risk tools: emits approval_request action, sets session status
  to 'awaiting_approval', and safely pauses execution.
- Emits policy observations and audit records for every check.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, NamedTuple, Optional, Tuple

import jsonschema

from .. import connectors, policy
from ..sqlite_adapter import get_connection
from .models import Action, Observation

logger = logging.getLogger("execution.harness.policy_guard")


class PolicyCheckResult(NamedTuple):
    allowed: bool
    status: str  # "allow", "needs_approval", "deny"
    reason: str
    action: Optional[Action] = None
    observation: Optional[Observation] = None
    policy_observation: Optional[Observation] = None


class PolicyGuard:
    """Enforces policy gating, risk approval, and forbidden connector blocks."""

    def __init__(self, tenant_id: str, caller_role: str = "engineer", caller_email: str = "system"):
        self.tenant_id = tenant_id
        self.caller_role = caller_role
        self.caller_email = caller_email

    def _record_audit(self, event: str, session_id: str, detail: Dict[str, Any]):
        try:
            with get_connection() as c:
                c.execute(
                    "INSERT INTO audit_log (tenant_id, actor, service, event, workflow_id, detail) "
                    "VALUES (%s, %s, 'execution', %s, %s, %s)",
                    (self.tenant_id, self.caller_email, event, session_id, json.dumps(detail or {})),
                )
                c.commit()
        except Exception as e:
            logger.warning("Failed to record audit log: %s", e)

    def check_tool_call(
        self,
        tool_name: str,
        params: Dict[str, Any],
        session_id: str,
        step: int,
        is_approved: bool = False,
    ) -> Tuple[PolicyCheckResult, Optional[Dict[str, Any]]]:
        """Interlocks with policy.decide:
        - Returns allowed=True if policy allows.
        - Returns allowed=False, status='needs_approval' with Action('approval_request') if approval required.
        - Returns allowed=False, status='deny' with Observation('error') if forbidden or unauthorized.
        """
        # 1. Lookup tool in DB for tenant
        with get_connection() as c:
            tool = c.execute(
                "SELECT name, description, input_schema, connector, secret_ref, risk "
                "FROM tools WHERE tenant_id=%s AND name=%s",
                (self.tenant_id, tool_name),
            ).fetchone()

        if not tool:
            # Check if this tool targets forbidden equipment actuation
            tool_lower = tool_name.lower()
            if "plc" in tool_lower or "machine_direct" in tool_lower:
                connector = "plc" if "plc" in tool_lower else "machine_direct"
                tool = {
                    "name": tool_name,
                    "connector": connector,
                    "risk": "high",
                    "secret_ref": None,
                    "input_schema": {},
                }
            else:
                reason = f"Unknown tool: '{tool_name}'"
                err_obs = Observation(
                    name="error",
                    payload={"error": reason, "tool": tool_name, "step": step},
                )
                policy_obs = Observation(
                    name="policy",
                    payload={
                        "decision": "deny",
                        "tool": tool_name,
                        "risk": "unknown",
                        "role": self.caller_role,
                        "reason": reason,
                        "step": step,
                    },
                )
                self._record_audit("policy.deny", session_id, {"step": step, "tool": tool_name, "reason": reason})
                return (
                    PolicyCheckResult(
                        allowed=False,
                        status="deny",
                        reason=reason,
                        observation=err_obs,
                        policy_observation=policy_obs,
                    ),
                    None,
                )

        # 2. Schema validation
        schema = tool["input_schema"] if isinstance(tool["input_schema"], dict) else {}
        if isinstance(tool.get("input_schema"), str) and tool["input_schema"].strip():
            try:
                schema = json.loads(tool["input_schema"])
            except Exception:
                schema = {}

        if schema:
            try:
                jsonschema.validate(params, schema)
            except jsonschema.ValidationError as e:
                reason = f"Tool '{tool_name}' invalid input arguments: {e.message}"
                err_obs = Observation(
                    name="error",
                    payload={"error": reason, "tool": tool_name, "step": step},
                )
                policy_obs = Observation(
                    name="policy",
                    payload={
                        "decision": "deny",
                        "tool": tool_name,
                        "risk": tool.get("risk", "medium"),
                        "role": self.caller_role,
                        "reason": reason,
                        "step": step,
                    },
                )
                self._record_audit("policy.deny", session_id, {"step": step, "tool": tool_name, "reason": reason})
                return (
                    PolicyCheckResult(
                        allowed=False,
                        status="deny",
                        reason=reason,
                        observation=err_obs,
                        policy_observation=policy_obs,
                    ),
                    tool,
                )

        # 3. Interlock with policy.decide
        decision, reason = policy.decide(tool, self.caller_role, is_approved)
        self._record_audit(
            f"policy.{decision}",
            session_id,
            {"step": step, "tool": tool_name, "risk": tool.get("risk"), "connector": tool.get("connector"), "reason": reason},
        )

        # 4. Handle policy outcome
        if decision == "deny":
            policy_obs = Observation(
                name="policy",
                payload={
                    "decision": "deny",
                    "tool": tool_name,
                    "connector": tool.get("connector"),
                    "risk": tool.get("risk"),
                    "role": self.caller_role,
                    "reason": reason,
                    "step": step,
                },
            )
            err_obs = Observation(
                name="error",
                payload={
                    "error": f"Policy denied execution of tool '{tool_name}': {reason}",
                    "tool": tool_name,
                    "connector": tool.get("connector"),
                    "step": step,
                },
            )
            return (
                PolicyCheckResult(
                    allowed=False,
                    status="deny",
                    reason=reason,
                    observation=err_obs,
                    policy_observation=policy_obs,
                ),
                tool,
            )

        if decision == "needs_approval":
            policy_obs = Observation(
                name="policy",
                payload={
                    "decision": "needs_approval",
                    "tool": tool_name,
                    "connector": tool.get("connector"),
                    "risk": tool.get("risk"),
                    "role": self.caller_role,
                    "reason": reason,
                    "step": step,
                },
            )
            approval_action = Action(
                name="approval_request",
                payload={
                    "tool": tool_name,
                    "connector": tool.get("connector"),
                    "risk": tool.get("risk", "medium"),
                    "params": params,
                    "reason": reason,
                    "step": step,
                },
            )
            return (
                PolicyCheckResult(
                    allowed=False,
                    status="needs_approval",
                    reason=reason,
                    action=approval_action,
                    observation=None,
                    policy_observation=policy_obs,
                ),
                tool,
            )

        # decision == "allow"
        allow_obs = Observation(
            name="policy",
            payload={
                "decision": "allow",
                "tool": tool_name,
                "connector": tool.get("connector"),
                "risk": tool.get("risk"),
                "role": self.caller_role,
                "reason": "ok",
                "step": step,
            },
        )
        return (
            PolicyCheckResult(
                allowed=True,
                status="allow",
                reason="ok",
                observation=None,
                policy_observation=allow_obs,
            ),
            tool,
        )

    def execute_tool(self, tool: Dict[str, Any], params: Dict[str, Any], session_id: str, step: int) -> Observation:
        """Executes authorized connector tool and returns tool_result observation."""
        connector_name = tool.get("connector", "log")
        provider = connectors.get(connector_name)
        out = provider.execute(connector_name, tool.get("secret_ref"), params)

        self._record_audit("tool.executed", session_id, {"step": step, "tool": tool.get("name")})

        return Observation(
            name="tool_result",
            payload={"tool": tool.get("name"), "result": out, "step": step},
        )
