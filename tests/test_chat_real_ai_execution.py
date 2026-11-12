"""Comprehensive Test Suite for Real AI Model Execution in Chat Routes.

Validates:
1. Google Gemini Direct REST Execution:
   - Clean model formatting (e.g. gemini-2.0-flash).
   - GenerativeLanguage API URL with api_key query param.
   - Conversion of messages to Gemini contents (user/model roles and parts) + system_instruction.
   - Extraction of generated candidate text.
2. OpenAI-Compatible Direct REST Execution (OpenAI, DeepSeek, Groq, etc.):
   - Bearer token header.
   - Endpoint URL construction (/chat/completions).
   - Response message content extraction.
3. Ollama Direct REST Execution:
   - /api/chat endpoint.
   - model, messages, stream: false payload.
   - Response extraction.
4. Anthropic Direct REST Execution:
   - /v1/messages endpoint.
   - x-api-key header and separated system prompt.
5. Real AI Attempt Triggering:
   - Attempts real AI completion when api_key is passed in request, OR provider env key is set, OR provider == 'ollama', even when MOCK_AI == '1'.
6. Fallback to Dynamic Contextual Synthesis:
   - When no key is configured and not Ollama, falls back gracefully.
   - When REST call fails/times out, falls back gracefully.
   - Response metadata contains live_ai: bool, provider_used, model_used, latency_ms.
7. Verification that static '### Operational Dashboard Telemetry' dump is removed:
   - Direct, query-specific, dynamic answers are synthesized instead.
"""
import os
import json
import pytest
import httpx
from fastapi.testclient import TestClient

os.environ["MOCK_AI"] = "1"
os.environ["SQLITE_PATH"] = "/tmp/cawrys_test_chat_real_ai.db"
os.environ["AUTH_SECRET"] = "0123456789012345678901234567890123456789012345678901234567890123"

from services.execution.app.auth import make_token
from services.execution.app.chat_routes import (
    _init_chat_tables,
    _execute_rest_completion,
    _execute_litellm_completion,
    _synthesize_contextual_response,
)
from services.execution.app.main import app as exec_app
from services.execution.app.sqlite_adapter import get_connection

TENANT_ID = "00000000-0000-0000-0000-000000000002"


@pytest.fixture(autouse=True)
def setup_db():
    _init_chat_tables()
    with get_connection() as c:
        c.execute("INSERT OR IGNORE INTO tenants (id, name) VALUES (%s, %s)", (TENANT_ID, "AI Test Tenant"))
        c.execute("DELETE FROM chat_messages WHERE tenant_id=%s", (TENANT_ID,))
        c.execute("DELETE FROM dashboard_overrides WHERE tenant_id=%s", (TENANT_ID,))
        c.execute("DELETE FROM litellm_user_configs WHERE tenant_id=%s", (TENANT_ID,))
        c.commit()


@pytest.fixture
def exec_client():
    return TestClient(exec_app)


@pytest.fixture
def auth_headers():
    token = make_token("admin-2", TENANT_ID, "admin", "admin@cawrys.local")
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Unit tests for _execute_rest_completion
# ---------------------------------------------------------------------------

def test_gemini_rest_completion(monkeypatch):
    """Google Gemini direct REST should build valid URL, contents format, and extract text."""
    captured_req = {}

    class MockResponse:
        status_code = 200

        def json(self):
            return {
                "candidates": [
                    {
                        "content": {
                            "role": "model",
                            "parts": [{"text": "Gemini 2.0 Flash response analysis."}],
                        }
                    }
                ]
            }

    def mock_post(url, json=None, headers=None, **kwargs):
        captured_req["url"] = str(url)
        captured_req["json"] = json
        captured_req["headers"] = headers
        return MockResponse()

    monkeypatch.setattr(httpx.Client, "post", lambda self, url, **kw: mock_post(url, **kw))

    messages = [
        {"role": "system", "content": "You are an industrial expert."},
        {"role": "user", "content": "What is the recommended spindle speed for Titanium?"},
    ]

    content, err = _execute_rest_completion(
        messages=messages,
        provider="gemini",
        model="gemini/gemini-2.0-flash",
        api_key="AIzaSyTestGeminiKey123",
    )

    assert err is None
    assert content == "Gemini 2.0 Flash response analysis."
    assert "generativelanguage.googleapis.com" in captured_req["url"]
    assert "models/gemini-2.0-flash:generateContent" in captured_req["url"]
    assert "key=AIzaSyTestGeminiKey123" in captured_req["url"]

    payload = captured_req["json"]
    assert "contents" in payload
    assert payload["contents"][0]["role"] == "user"
    assert payload["contents"][0]["parts"][0]["text"] == "What is the recommended spindle speed for Titanium?"
    assert "system_instruction" in payload
    assert payload["system_instruction"]["parts"][0]["text"] == "You are an industrial expert."


def test_openai_compatible_rest_completion(monkeypatch):
    """OpenAI-compatible REST (DeepSeek, Groq, OpenAI) should call /chat/completions with Bearer token."""
    captured_req = {}

    class MockResponse:
        status_code = 200

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "DeepSeek R1 reasoning response regarding telemetry.",
                        }
                    }
                ]
            }

    def mock_post(url, json=None, headers=None, **kwargs):
        captured_req["url"] = str(url)
        captured_req["json"] = json
        captured_req["headers"] = headers
        return MockResponse()

    monkeypatch.setattr(httpx.Client, "post", lambda self, url, **kw: mock_post(url, **kw))

    messages = [
        {"role": "system", "content": "Operational Copilot."},
        {"role": "user", "content": "Check thermal sensor calibration."},
    ]

    content, err = _execute_rest_completion(
        messages=messages,
        provider="deepseek",
        model="deepseek/deepseek-chat",
        api_key="sk-deepseek-test-key",
        base_url="https://api.deepseek.com",
    )

    assert err is None
    assert content == "DeepSeek R1 reasoning response regarding telemetry."
    assert captured_req["url"] == "https://api.deepseek.com/chat/completions"
    assert captured_req["headers"]["Authorization"] == "Bearer sk-deepseek-test-key"
    assert captured_req["json"]["model"] == "deepseek-chat"


def test_ollama_rest_completion(monkeypatch):
    """Ollama REST should post to /api/chat with model and stream=False."""
    captured_req = {}

    class MockResponse:
        status_code = 200

        def json(self):
            return {
                "message": {
                    "role": "assistant",
                    "content": "Ollama Llama 3.2 local model reply.",
                }
            }

    def mock_post(url, json=None, headers=None, **kwargs):
        captured_req["url"] = str(url)
        captured_req["json"] = json
        return MockResponse()

    monkeypatch.setattr(httpx.Client, "post", lambda self, url, **kw: mock_post(url, **kw))

    messages = [{"role": "user", "content": "Summarize plant status."}]

    content, err = _execute_rest_completion(
        messages=messages,
        provider="ollama",
        model="ollama/llama3.2:latest",
        base_url="http://localhost:11434",
    )

    assert err is None
    assert content == "Ollama Llama 3.2 local model reply."
    assert captured_req["url"] == "http://localhost:11434/api/chat"
    assert captured_req["json"]["model"] == "llama3.2:latest"
    assert captured_req["json"]["stream"] is False


def test_anthropic_rest_completion(monkeypatch):
    """Anthropic REST should post to /v1/messages with x-api-key and system field."""
    captured_req = {}

    class MockResponse:
        status_code = 200

        def json(self):
            return {
                "content": [
                    {"type": "text", "text": "Anthropic Claude 3.5 Sonnet direct REST reply."}
                ]
            }

    def mock_post(url, json=None, headers=None, **kwargs):
        captured_req["url"] = str(url)
        captured_req["json"] = json
        captured_req["headers"] = headers
        return MockResponse()

    monkeypatch.setattr(httpx.Client, "post", lambda self, url, **kw: mock_post(url, **kw))

    messages = [
        {"role": "system", "content": "You are a CAD engineer."},
        {"role": "user", "content": "Inspect turbine flange tolerance."},
    ]

    content, err = _execute_rest_completion(
        messages=messages,
        provider="anthropic",
        model="anthropic/claude-3-5-sonnet-20241022",
        api_key="sk-ant-test-key",
    )

    assert err is None
    assert content == "Anthropic Claude 3.5 Sonnet direct REST reply."
    assert "https://api.anthropic.com/v1/messages" in captured_req["url"]
    assert captured_req["headers"]["x-api-key"] == "sk-ant-test-key"
    assert captured_req["json"]["system"] == "You are a CAD engineer."
    assert captured_req["json"]["model"] == "claude-3-5-sonnet-20241022"


# ---------------------------------------------------------------------------
# Unit tests for _execute_litellm_completion & Fallbacks
# ---------------------------------------------------------------------------

def test_litellm_falls_back_to_direct_rest(monkeypatch):
    """When LiteLLM throws an exception, _execute_litellm_completion should fallback to REST."""
    def failing_litellm(**kwargs):
        raise RuntimeError("LiteLLM library connection error or proxy timeout")

    class MockResponse:
        status_code = 200

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "Recovered via Direct REST fallback!",
                        }
                    }
                ]
            }

    import litellm
    monkeypatch.setattr(litellm, "completion", failing_litellm)
    monkeypatch.setattr(httpx.Client, "post", lambda self, url, **kw: MockResponse())

    content, err = _execute_litellm_completion(
        messages=[{"role": "user", "content": "Test fallback"}],
        provider="groq",
        model="groq/llama-3.3-70b-versatile",
        api_key="gsk_test_key_123",
        base_url="https://api.groq.com/openai/v1",
    )

    assert content == "Recovered via Direct REST fallback!"
    assert err is None


def test_no_credentials_skips_network_call():
    """When no key is provided and provider is not Ollama, AI call should skip without errors."""
    content, err = _execute_litellm_completion(
        messages=[{"role": "user", "content": "Hello"}],
        provider="gemini",
        model="gemini/gemini-2.0-flash",
        api_key="",
    )
    assert content is None
    assert err == "no_credentials"


# ---------------------------------------------------------------------------
# Endpoint tests: /v1/chat/message with live AI execution & metadata
# ---------------------------------------------------------------------------

def test_chat_message_real_gemini_execution_and_metadata(exec_client, auth_headers, monkeypatch):
    """Chat message route with Gemini API key should execute real AI and return live_ai: True and model metadata."""
    class MockGeminiResponse:
        status_code = 200

        def json(self):
            return {
                "candidates": [
                    {
                        "content": {
                            "role": "model",
                            "parts": [{"text": "Real Google Gemini 2.5 Flash response: Facility status is nominal."}],
                        }
                    }
                ]
            }

    orig_post = httpx.Client.post

    def selective_post(self, url, *args, **kwargs):
        url_str = str(url)
        if ":generateContent" in url_str:
            return MockGeminiResponse()
        return orig_post(self, url, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "post", selective_post)

    payload = {
        "message": "Evaluate Line 2 OEE performance",
        "provider": "gemini",
        "model": "gemini-2.5-flash",
        "api_key": "AIzaSyLiveGeminiTestKey",
    }

    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()

    assert data["live_ai"] is True
    assert data["provider_used"] == "gemini"
    assert data["model_used"] == "gemini-2.5-flash"
    assert data["content"] == "Real Google Gemini 2.5 Flash response: Facility status is nominal."
    assert "latency_ms" in data
    assert isinstance(data["latency_ms"], int)
    assert data["latency_ms"] >= 0

    # Ensure metadata contains required fields
    meta = data["metadata"]
    assert meta["live_ai"] is True
    assert meta["provider_used"] == "gemini"
    assert meta["model_used"] == "gemini-2.5-flash"
    assert "latency_ms" in meta


def test_chat_message_real_ollama_execution(exec_client, auth_headers, monkeypatch):
    """Chat message with Ollama provider should attempt real AI execution even without API key."""
    class MockOllamaResponse:
        status_code = 200

        def json(self):
            return {
                "message": {
                    "role": "assistant",
                    "content": "Real Ollama local model analysis of machine vibrations.",
                }
            }

    orig_post = httpx.Client.post

    def selective_post(self, url, *args, **kwargs):
        url_str = str(url)
        if "/api/chat" in url_str:
            return MockOllamaResponse()
        return orig_post(self, url, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "post", selective_post)

    payload = {
        "message": "Analyze CNC spindle vibration readings",
        "provider": "ollama",
        "model": "llama3.2:latest",
        "base_url": "http://localhost:11434",
    }

    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()

    assert data["live_ai"] is True
    assert data["provider_used"] == "ollama"
    assert data["model_used"] == "llama3.2:latest"
    assert data["content"] == "Real Ollama local model analysis of machine vibrations."
    assert data["metadata"]["live_ai"] is True


def test_chat_message_fallback_on_network_failure(exec_client, auth_headers, monkeypatch):
    """When network fails/times out, chat message should fall back to dynamic synthesis with live_ai: False."""
    orig_post = httpx.Client.post

    def selective_post(self, url, *args, **kwargs):
        url_str = str(url)
        if "/chat/completions" in url_str or "api.openai.com" in url_str:
            raise httpx.ConnectTimeout("Connection to LLM host timed out")
        return orig_post(self, url, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "post", selective_post)

    payload = {
        "message": "What is our current OEE and operational status?",
        "provider": "openai",
        "model": "gpt-4o",
        "api_key": "sk-unreachable-key",
    }

    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()

    # Falls back gracefully to contextual synthesis
    assert data["live_ai"] is False
    assert data["metadata"]["live_ai"] is False
    assert data["provider_used"] == "openai"
    assert data["model_used"] == "gpt-4o"
    # Should answer the question directly with real telemetry numbers
    assert "87.4%" in data["content"]
    assert "Optimal" in data["content"]
    # Static boilerplate header must NOT be present
    assert "### Operational Dashboard Telemetry" not in data["content"]


# ---------------------------------------------------------------------------
# Tests for _synthesize_contextual_response removal of static boilerplate
# ---------------------------------------------------------------------------

def test_synthesized_response_no_static_boilerplate():
    """Verify that _synthesize_contextual_response provides dynamic answers without static dumps."""
    context = {
        "metrics": {
            "oee": "91.2%",
            "production_target": "2,500 units",
            "operational_status": "RunningFullCapacity",
            "system_health": "Optimal",
            "risk_level": "LOW",
            "active_work_orders": 28,
            "active_documents": 15,
        },
        "connections": [{"app_name": "SAP S/4HANA", "status": "connected"}],
        "tools": [{"name": "sap_stock", "description": "Stock lookup"}],
        "documents": [],
    }

    # 1. Telemetry query
    resp1 = _synthesize_contextual_response("What is our current OEE and operational status?", context)
    assert "### Operational Dashboard Telemetry" not in resp1
    assert "91.2%" in resp1
    assert "RunningFullCapacity" in resp1

    # 2. Risk query
    resp2 = _synthesize_contextual_response("What is the operational risk level right now?", context)
    assert "### Operational Dashboard Telemetry" not in resp2
    assert "LOW" in resp2
    assert "RunningFullCapacity" in resp2

    # 3. Production target query
    resp3 = _synthesize_contextual_response("What is our production target for this shift?", context)
    assert "### Operational Dashboard Telemetry" not in resp3
    assert "2,500 units" in resp3

    # 4. Equipment troubleshooting query
    resp4 = _synthesize_contextual_response("How should we handle thermal sensor drift on the pump bearing?", context)
    assert "### Operational Dashboard Telemetry" not in resp4
    assert "thermal sensor drift on the pump bearing" in resp4.lower()
    assert "91.2%" in resp4
    assert "LOW" in resp4

    # 5. General query
    resp5 = _synthesize_contextual_response("Can you help me understand line optimization?", context)
    assert "### Operational Dashboard Telemetry" not in resp5
    assert "line optimization" in resp5.lower()
    assert "91.2%" in resp5
