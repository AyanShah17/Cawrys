"""Deterministic Mock Execution Engine for OpenHands Agent Harness.

Used when MOCK_AI=1 or when GEMINI_API_KEY is not configured.
Provides predictable, reproducible action-observation steps:
- session_start -> plan -> tool_call (or approval_request) -> observation -> agent_finish
- Full offline operation with zero network dependencies.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from .models import Action


def is_mock_enabled() -> bool:
    """Returns True if MOCK_AI=1 or GEMINI_API_KEY is absent/empty."""
    mock_env = os.environ.get("MOCK_AI")
    if mock_env is not None and mock_env.strip() != "":
        return mock_env.strip().lower() in ("1", "true", "yes", "on")
    # Auto-activate when GEMINI_API_KEY is missing or empty
    return not bool(os.environ.get("GEMINI_API_KEY", "").strip())


class MockEngine:
    """Deterministic step generator for Orchestrator and Worker in offline testing."""

    @staticmethod
    def orchestrate_step(
        task: str,
        context: Dict[str, Any],
        events: List[Any],
        available_tools: List[Dict[str, Any]],
        step: int,
    ) -> Action:
        """Produces a deterministic next action based on event history."""
        tool_names = {t["name"] for t in available_tools}
        task_lower = task.lower()

        # Step 1: Initial Planning
        has_plan = any(
            (e.get("name") if hasattr(e, "get") else getattr(e, "name", None)) == "plan"
            for e in events
            if (e.get("event_type") if hasattr(e, "get") else getattr(e, "type", None)) in ("action", "Action")
            or (e.get("type") if hasattr(e, "get") else getattr(e, "type", None)) in ("action", "Action")
        )
        if not has_plan:
            return Action(
                name="plan",
                payload={
                    "thought": f"Plan for objective: {task}",
                    "goal": task,
                    "steps": [
                        "Decompose task and verify input specifications",
                        "Query inventory stock levels in ERP",
                        "Schedule production order in MES",
                        "Notify production team",
                    ],
                    "rationale": "Operational plan for task execution.",
                },
            )

        # Step 2: Delegation check (if task mentions extraction or drawing)
        has_delegate = any(
            (e.get("name") if hasattr(e, "get") else getattr(e, "name", None)) == "delegate"
            for e in events
            if (e.get("event_type") if hasattr(e, "get") else getattr(e, "type", None)) in ("action", "Action")
            or (e.get("type") if hasattr(e, "get") else getattr(e, "type", None)) in ("action", "Action")
        )
        if ("extract" in task_lower or "drawing" in task_lower or "inspect" in task_lower) and not has_delegate:
            w_type = "vision" if "drawing" in task_lower or "vision" in task_lower else "extract"
            return Action(
                name="delegate",
                payload={
                    "worker_type": w_type,
                    "task": f"Extract drawing and specification parameters for: {task}",
                    "input_data": context,
                },
            )

        # Step 3: Tool selection based on past executed tool results
        executed_tools = set()
        for e in events:
            ev_name = e.get("name") if hasattr(e, "get") else getattr(e, "name", None)
            ev_type = e.get("event_type") if hasattr(e, "get") else getattr(e, "type", None)
            if ev_name == "tool_result":
                payload = e.get("payload") if hasattr(e, "get") else getattr(e, "payload", {})
                if isinstance(payload, dict) and "tool" in payload:
                    executed_tools.add(payload["tool"])
                elif isinstance(payload, dict) and "tool_name" in payload:
                    executed_tools.add(payload["tool_name"])

        # Check for forbidden connector test request
        if "plc" in task_lower or "machine_direct" in task_lower:
            plc_tool = next((t["name"] for t in available_tools if t.get("connector") in ("plc", "machine_direct")), None)
            target_tool = plc_tool or "plc_actuator"
            if target_tool not in executed_tools:
                return Action(
                    name="tool_call",
                    payload={"tool": target_tool, "params": {"cmd": "START_MOTOR"}, "rationale": "Direct PLC actuation test."},
                )

        # Tool 1: erp_lookup_inventory (low risk)
        if "erp_lookup_inventory" in tool_names and "erp_lookup_inventory" not in executed_tools:
            material = context.get("material", "Aluminum 6061")
            return Action(
                name="tool_call",
                payload={
                    "tool": "erp_lookup_inventory",
                    "params": {"material": material},
                    "rationale": "Verify material availability in ERP.",
                },
            )

        # Tool 2: schedule_production (medium risk -> triggers approval request)
        if ("schedule" in task_lower or "production" in task_lower or "all" in task_lower or "complex" in task_lower) and "schedule_production" in tool_names and "schedule_production" not in executed_tools:
            dwg = context.get("drawing_id", "DWG-1042")
            qty = context.get("quantity", 25)
            return Action(
                name="tool_call",
                payload={
                    "tool": "schedule_production",
                    "params": {"drawing_id": dwg, "quantity": qty},
                    "rationale": "Create production schedule in MES.",
                },
            )

        # Tool 3: notify_team (low risk)
        if "notify_team" in tool_names and "notify_team" not in executed_tools:
            return Action(
                name="tool_call",
                payload={
                    "tool": "notify_team",
                    "params": {"message": f"Setup completed for task: {task}"},
                    "rationale": "Notify production team of completed schedule.",
                },
            )

        # Execute any remaining tools registered by caller
        for t in available_tools:
            t_name = t["name"]
            if t_name not in executed_tools and t_name not in ("erp_lookup_inventory", "schedule_production", "notify_team"):
                schema = t.get("input_schema", {})
                props = schema.get("properties", {}) if isinstance(schema, dict) else {}
                sample_params = {}
                for k, v in props.items():
                    sample_params[k] = "test_val" if v.get("type") == "string" else 1
                return Action(
                    name="tool_call",
                    payload={"tool": t_name, "params": sample_params, "rationale": f"Executing custom tool {t_name}"},
                )

        # Step 4: Completion
        return Action(
            name="agent_finish",
            payload={
                "status": "completed",
                "summary": f"Completed execution of task '{task}'. All planned operational steps succeeded.",
                "outputs": {"task": task, "context": context, "steps_executed": step},
            },
        )

    @staticmethod
    def worker_execute(worker_type: str, task: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Produces deterministic extraction results for Worker."""
        return {
            "status": "success",
            "worker_type": worker_type,
            "model": "gemini-3.8-flash (mock)",
            "extracted_data": {
                "material": input_data.get("material", "Aluminum 6061-T6"),
                "drawing_id": input_data.get("drawing_id", "DWG-1042"),
                "quantity": input_data.get("quantity", 25),
                "tolerance": "+/- 0.05 mm",
                "verified": True,
            },
            "confidence": {
                "material": 0.98,
                "drawing_id": 0.96,
                "quantity": 0.99,
                "tolerance": 0.92,
            },
            "summary": f"Mock {worker_type} worker successfully extracted fields for task: {task}",
        }
