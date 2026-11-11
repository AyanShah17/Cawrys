"""Orchestrator Agent for OpenHands execution harness.

Powered by Gemini 4 Argon via LiteLLM model alias 'cawrys-reason'.
Decomposes high-level user tasks, produces action plans, and delegates
sub-tasks to Workers or tool invocations.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

import httpx

from .mock import MockEngine, is_mock_enabled
from .models import Action

logger = logging.getLogger("execution.harness.orchestrator")


class Orchestrator:
    """Gemini 4 Argon Orchestrator for strategic planning and task delegation."""

    def __init__(self, tenant_id: str, available_tools: List[Dict[str, Any]]):
        self.tenant_id = tenant_id
        self.available_tools = available_tools
        self.model = os.environ.get("MODEL_REASON", "cawrys-reason")
        self.litellm_base = os.environ.get("LITELLM_BASE_URL", "http://localhost:4000")
        self.litellm_key = os.environ.get("LITELLM_MASTER_KEY", "")

    def _format_tools_prompt(self) -> str:
        lines = []
        for t in self.available_tools:
            lines.append(f"- Tool: {t['name']} (connector: {t.get('connector')}, risk: {t.get('risk')})")
            lines.append(f"  Description: {t.get('description', '')}")
            lines.append(f"  Schema: {json.dumps(t.get('input_schema', {}))}")
        return "\n".join(lines)

    def step(
        self,
        task: str,
        context: Dict[str, Any],
        history: List[Any],
        step_num: int,
    ) -> Action:
        """Determines the next action in the action-observation loop."""
        # 1. Deterministic offline fallback when MOCK_AI=1 or GEMINI_API_KEY is absent
        if is_mock_enabled():
            return MockEngine.orchestrate_step(
                task=task,
                context=context,
                events=history,
                available_tools=self.available_tools,
                step=step_num,
            )

        # 2. Live execution via LiteLLM proxy
        system_prompt = (
            "You are the Cawrys Orchestrator Agent powered by Gemini 4 Argon (alias: cawrys-reason).\n"
            "Your role is strategic task decomposition, action planning, tool invocation, and worker delegation.\n\n"
            "AVAILABLE TOOLS:\n"
            f"{self._format_tools_prompt()}\n\n"
            "RULES:\n"
            "1. Output ONLY a valid JSON object with schema:\n"
            "{\n"
            '  "action": "plan" | "tool_call" | "delegate" | "agent_finish",\n'
            '  "payload": dict,\n'
            '  "thought": str\n'
            "}\n"
            "2. For 'plan': payload = {'goal': str, 'steps': [str], 'rationale': str}\n"
            "3. For 'tool_call': payload = {'tool': str, 'params': dict, 'rationale': str}\n"
            "4. For 'delegate': payload = {'worker_type': 'extract' | 'vision', 'task': str, 'input_data': dict}\n"
            "5. For 'agent_finish': payload = {'status': 'completed', 'summary': str, 'outputs': dict}\n"
            "6. Direct actuation via 'plc' or 'machine_direct' is FORBIDDEN. Never attempt direct actuation.\n"
            "7. Medium and high risk tools require human approval before execution.\n"
        )

        formatted_history = []
        for h in (history[-10:] if history else []):
            if hasattr(h, "to_sse_dict"):
                formatted_history.append(h.to_sse_dict())
            elif isinstance(h, dict):
                formatted_history.append(h)
            else:
                formatted_history.append(str(h))

        user_content = {
            "task": task,
            "context": context,
            "step": step_num,
            "history": formatted_history,
        }

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_content)},
        ]

        try:
            headers = {"Content-Type": "application/json"}
            if self.litellm_key:
                headers["Authorization"] = f"Bearer {self.litellm_key}"

            resp = httpx.post(
                f"{self.litellm_base.rstrip('/')}/chat/completions",
                headers=headers,
                json={
                    "model": self.model,
                    "messages": messages,
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                },
                timeout=45.0,
            )
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)

            act_name = parsed.get("action", "agent_finish")
            payload = parsed.get("payload", {})
            return Action(name=act_name, payload=payload)

        except Exception as e:
            logger.warning("Live LiteLLM call failed (%s); falling back to deterministic mock engine.", e)
            return MockEngine.orchestrate_step(
                task=task,
                context=context,
                events=history,
                available_tools=self.available_tools,
                step=step_num,
            )
