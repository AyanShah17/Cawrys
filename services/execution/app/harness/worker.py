"""Worker Agent for OpenHands execution harness.

Powered by Gemini 3.8 Flash via LiteLLM model aliases:
- 'cawrys-extract' for high-throughput text & structured data extraction.
- 'cawrys-vision' for technical drawing, CAD diagram & document inspection.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, Optional

import httpx

from .mock import MockEngine, is_mock_enabled
from .models import Observation

logger = logging.getLogger("execution.harness.worker")


class Worker:
    """Gemini 3.8 Flash Worker for specialized data extraction and document inspection."""

    def __init__(self, tenant_id: str):
        self.tenant_id = tenant_id
        self.model_extract = os.environ.get("MODEL_EXTRACT", "cawrys-extract")
        self.model_vision = os.environ.get("MODEL_VISION", "cawrys-vision")
        self.litellm_base = os.environ.get("LITELLM_BASE_URL", "http://localhost:4000")
        self.litellm_key = os.environ.get("LITELLM_MASTER_KEY", "")

    def execute_delegation(
        self,
        worker_type: str,
        task: str,
        input_data: Dict[str, Any],
        step_num: int,
    ) -> Observation:
        """Executes a delegated task using Gemini 3.8 Flash."""
        # 1. Deterministic offline fallback when MOCK_AI=1 or GEMINI_API_KEY is absent
        if is_mock_enabled():
            result = MockEngine.worker_execute(worker_type=worker_type, task=task, input_data=input_data)
            return Observation(
                name="delegate_result",
                payload={"worker_type": worker_type, "step": step_num, **result},
            )

        # 2. Live execution via LiteLLM proxy
        model = self.model_vision if worker_type in ("vision", "drawing") else self.model_extract
        system_prompt = (
            f"You are the Cawrys Worker Agent powered by Gemini 3.8 Flash (alias: {model}).\n"
            "Your role is fast, accurate structured extraction, document inspection, and field normalization.\n"
            'Return JSON: {"status": "success"|"error", "extracted_data": dict, "confidence": dict, "summary": str}.'
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps({"task": task, "input_data": input_data})},
        ]

        try:
            headers = {"Content-Type": "application/json"}
            if self.litellm_key:
                headers["Authorization"] = f"Bearer {self.litellm_key}"

            resp = httpx.post(
                f"{self.litellm_base.rstrip('/')}/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                },
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)

            return Observation(
                name="delegate_result",
                payload={"worker_type": worker_type, "step": step_num, **parsed},
            )

        except Exception as e:
            logger.warning("Live worker call failed (%s); falling back to deterministic mock.", e)
            result = MockEngine.worker_execute(worker_type=worker_type, task=task, input_data=input_data)
            return Observation(
                name="delegate_result",
                payload={"worker_type": worker_type, "step": step_num, **result},
            )
