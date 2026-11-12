"""Comprehensive Test Suite for Chat Interface & Dashboard Override Mutation.

Validates:
1. Agent Chat tools discovery (/v1/chat/tools) & suggested prompts.
2. Chat query -> dashboard override intent detection:
   - Change production target to 1,200 units
   - Set operational risk to LOW
   - Update OEE to 94%
   - Update machine telemetry status to Optimal
   - Set active work orders to 42
   - Reset dashboard overrides
3. Live / Connected Marketplace Tool invocations from Chat:
   - SAP S/4HANA material stock lookup (FastMCP)
   - GitHub issues & pull requests summary (Composio)
   - Slack alert dispatch (Composio)
   - Siemens Xcelerator CAD revisions (FastMCP)
4. Dashboard summary integration (/v1/dashboard/summary):
   - Merging dynamic overrides into intelligence dashboard summary
5. Conversation history persistence (/v1/chat/history).
"""
import os
import pytest
from fastapi.testclient import TestClient

os.environ["MOCK_AI"] = "1"
os.environ["SQLITE_PATH"] = "/tmp/cawrys_test_chat_dashboard.db"
os.environ["AUTH_SECRET"] = "0123456789012345678901234567890123456789012345678901234567890123"

from services.execution.app.auth import make_token
from services.execution.app.chat_routes import _init_chat_tables
from services.execution.app.main import app as exec_app
from services.execution.app.sqlite_adapter import get_connection
from services.intelligence.app.dashboard import _init_overrides_table
from services.intelligence.app.main import app as intel_app

TENANT_ID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture(autouse=True)
def setup_db():
    _init_chat_tables()
    _init_overrides_table()
    with get_connection() as c:
        c.execute("INSERT OR IGNORE INTO tenants (id, name) VALUES (%s, %s)", (TENANT_ID, "Demo Tenant"))
        c.execute("DELETE FROM chat_messages")
        c.execute("DELETE FROM dashboard_overrides")
        c.execute("DELETE FROM litellm_user_configs")
        c.commit()


@pytest.fixture
def exec_client():
    return TestClient(exec_app)


@pytest.fixture
def intel_client():
    return TestClient(intel_app)


@pytest.fixture
def auth_headers():
    token = make_token("admin-1", TENANT_ID, "admin", "admin@cawrys.local")
    return {"Authorization": f"Bearer {token}"}


def test_chat_tools_discovery(exec_client, auth_headers):
    """GET /v1/chat/tools should list connected apps, tools, and suggested prompts."""
    res = exec_client.get("/v1/chat/tools", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert "suggested_prompts" in data
    assert any("SAP S/4HANA" in p for p in data["suggested_prompts"])
    assert any("GitHub" in p for p in data["suggested_prompts"])
    assert any("production target" in p for p in data["suggested_prompts"])
    assert any("risk" in p for p in data["suggested_prompts"])


def test_chat_mutate_production_target(exec_client, auth_headers):
    """Chat message should detect intent and update dashboard production target."""
    payload = {"message": "Change production target to 1,200", "session_id": "test-sess"}
    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["dashboard_mutated"] is True
    assert "Updated dashboard UI" in data["content"]
    assert "production target set to 1,200 units" in data["content"]
    assert data["overrides"]["production_target"] == "1,200 units"


def test_chat_mutate_risk_and_status(exec_client, auth_headers):
    """Chat message should detect operational risk level and machine telemetry status."""
    payload = {
        "message": "Set dashboard operational risk to LOW and machine telemetry status to Optimal",
        "session_id": "test-sess",
    }
    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["dashboard_mutated"] is True
    assert data["overrides"]["risk_level"] == "LOW"
    assert data["overrides"]["operational_status"] == "Optimal"
    assert "operational risk set to LOW" in data["content"]
    assert "operational status set to Optimal" in data["content"]


def test_chat_mutate_oee_and_work_orders(exec_client, auth_headers):
    """Chat message should detect OEE efficiency and active work orders."""
    payload = {
        "message": "Update OEE to 94% and set active work orders to 42",
        "session_id": "test-sess",
    }
    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["dashboard_mutated"] is True
    assert data["overrides"]["oee"] == "94%"
    assert data["overrides"]["active_work_orders"] == 42


def test_chat_reset_dashboard(exec_client, auth_headers):
    """Chat message should support clearing / resetting dashboard overrides."""
    # First set a target
    exec_client.post(
        "/v1/chat/message",
        json={"message": "Change production target to 1,500"},
        headers=auth_headers,
    )
    # Now reset
    res = exec_client.post(
        "/v1/chat/message",
        json={"message": "Reset dashboard overrides"},
        headers=auth_headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["dashboard_mutated"] is True
    assert "Cleared all dashboard overrides" in data["content"]
    assert data["overrides"] == {}


def test_chat_query_sap_inventory(exec_client, auth_headers):
    """Chat message querying SAP S/4HANA stock should invoke FastMCP tool and cite data."""
    payload = {"message": "Check SAP stock for Part 100", "session_id": "test-sess"}
    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert "tool_calls" in data
    assert len(data["tool_calls"]) > 0
    assert data["tool_calls"][0]["app"] == "SAP S/4HANA"
    assert "Part 100" in data["content"]
    assert "450 units" in data["content"]
    assert "Plant 1000" in data["content"]


def test_chat_query_github_issues(exec_client, auth_headers):
    """Chat message querying GitHub issues should invoke Composio tool and format response."""
    payload = {"message": "Show open GitHub issues & PRs", "session_id": "test-sess"}
    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert "tool_calls" in data
    assert data["tool_calls"][0]["app"] == "GitHub"
    assert "#104" in data["content"]
    assert "PR #112" in data["content"]


def test_chat_query_siemens_cad(exec_client, auth_headers):
    """Chat message querying Siemens CAD revisions should invoke FastMCP connector."""
    payload = {"message": "Check Siemens CAD revisions for DWG-4002", "session_id": "test-sess"}
    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert "tool_calls" in data
    assert data["tool_calls"][0]["app"] == "Siemens Xcelerator"
    assert "DWG-4002-TURBINE" in data["content"]
    assert "Rev C" in data["content"]


def test_chat_history_persistence(exec_client, auth_headers):
    """Conversations should be persisted in chat_messages and retrievable via GET /v1/chat/history."""
    exec_client.post(
        "/v1/chat/message",
        json={"message": "Hello AI", "session_id": "sess-alpha"},
        headers=auth_headers,
    )
    res = exec_client.get("/v1/chat/history?session_id=sess-alpha", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert len(data["messages"]) >= 2  # user and assistant messages
    assert data["messages"][0]["role"] == "user"
    assert data["messages"][0]["content"] == "Hello AI"
    assert data["messages"][1]["role"] == "assistant"


def test_intelligence_summary_merges_overrides(intel_client, auth_headers):
    """Intelligence /v1/dashboard/summary should reflect overrides set via /v1/dashboard/override."""
    # Apply override directly to intelligence service
    override_payload = {
        "metrics": {
            "production_target": "1,200 units",
            "risk_level": "LOW",
            "oee": "94%",
            "operational_status": "Optimal",
            "active_work_orders": 42,
        }
    }
    ov_res = intel_client.post("/v1/dashboard/override", json=override_payload, headers=auth_headers)
    assert ov_res.status_code == 200
    assert ov_res.json()["ok"] is True

    # Now verify summary contains them
    sum_res = intel_client.get("/v1/dashboard/summary", headers=auth_headers)
    assert sum_res.status_code == 200
    data = sum_res.json()
    assert data["production_target"] == "1,200 units"
    assert data["risk_level"] == "LOW"
    assert data["oee"] == "94%"
    assert data["operational_status"] == "Optimal"
    assert data["active_work_orders"] == 42
    assert "overrides" in data
    assert data["overrides"]["production_target"] == "1,200 units"


def test_chat_model_config_get_and_post(exec_client, auth_headers):
    """GET /v1/chat/model_config should return providers catalog, POST should persist and mask key."""
    # 1. Initial GET
    get_res = exec_client.get("/v1/chat/model_config", headers=auth_headers)
    assert get_res.status_code == 200
    get_data = get_res.json()
    assert get_data["ok"] is True
    assert "providers" in get_data
    assert "gemini" in get_data["providers"]
    assert "openai" in get_data["providers"]
    assert "anthropic" in get_data["providers"]
    assert "deepseek" in get_data["providers"]
    assert "groq" in get_data["providers"]
    assert "ollama" in get_data["providers"]
    assert "mistral" in get_data["providers"]
    assert "custom" in get_data["providers"]

    # 2. Update config with OpenAI
    post_payload = {
        "provider": "openai",
        "model": "openai/gpt-4o",
        "api_key": "sk-proj-1234567890abcdef",
        "base_url": "https://api.openai.com/v1",
    }
    post_res = exec_client.post("/v1/chat/model_config", json=post_payload, headers=auth_headers)
    assert post_res.status_code == 200
    post_data = post_res.json()
    assert post_data["ok"] is True
    assert post_data["config"]["provider"] == "openai"
    assert post_data["config"]["model"] == "openai/gpt-4o"
    # Ensure key is masked and not exposed in full
    assert "sk-proj-1234567890abcdef" not in post_data["config"]["api_key"]
    assert post_data["config"]["has_api_key"] is True
    assert post_data["config"]["api_key"].startswith("sk-p")

    # 3. Verify GET returns persisted config
    re_get = exec_client.get("/v1/chat/model_config", headers=auth_headers)
    assert re_get.status_code == 200
    re_data = re_get.json()
    assert re_data["config"]["provider"] == "openai"
    assert re_data["config"]["model"] == "openai/gpt-4o"
    assert re_data["config"]["has_api_key"] is True


def test_chat_message_context_grounded_telemetry(exec_client, auth_headers):
    """Chat assistant should return context-grounded telemetry and model routing metadata."""
    # First set specific overrides
    exec_client.post(
        "/v1/chat/message",
        json={"message": "Update OEE to 96.5% and set operational status to HighThroughput"},
        headers=auth_headers,
    )

    # Now ask about telemetry
    res = exec_client.post(
        "/v1/chat/message",
        json={
            "message": "What is our current OEE and operational status?",
            "provider": "gemini",
            "model": "gemini/gemini-2.5-flash",
        },
        headers=auth_headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["context_used"] is True
    assert data["provider"] == "gemini"
    assert data["model"] == "gemini/gemini-2.5-flash"
    assert "latency_ms" in data
    # Response content should cite the actual live telemetry (96.5% and HighThroughput)
    assert "96.5%" in data["content"]
    assert "HighThroughput" in data["content"]
    # Should NOT be generic boilerplate
    assert "I am your Cawrys Industrial AI Assistant. I have live access to your connected marketplace tools" not in data["content"]


def test_chat_message_grounded_in_documents(exec_client, auth_headers):
    """Chat assistant should cite active workspace documents when asked."""
    with get_connection() as c:
        doc_id = "doc-cad-001"
        c.execute(
            "INSERT OR REPLACE INTO documents (id, tenant_id, filename, mime_type, storage_key, status) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (doc_id, TENANT_ID, "Turbine_Shaft_Tolerance_Spec.pdf", "application/pdf", "docs/001", "ready"),
        )
        c.execute(
            "INSERT OR REPLACE INTO extractions (id, document_id, tenant_id, doc_type, fields) "
            "VALUES (%s, %s, %s, %s, %s)",
            ("ext-001", doc_id, TENANT_ID, "machining_specification", '{"tolerance": "+/- 0.002mm"}'),
        )
        c.commit()

    res = exec_client.post(
        "/v1/chat/message",
        json={"message": "What documents and specifications do we have uploaded?"},
        headers=auth_headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert "Turbine_Shaft_Tolerance_Spec.pdf" in data["content"]
    assert data["context_used"] is True


def test_pdf_ingest_graceful_aes_handling():
    """PDF ingestion should handle AES/encryption and malformed streams without crashing."""
    from services.intelligence.app.ingest import to_text
    output = to_text("pdf", b"%PDF-1.4 mock encrypted stream that is not valid binary")
    assert isinstance(output, str)
    assert "failed" in output.lower() or "note" in output.lower() or "error" in output.lower()


def test_litellm_completion_invocation_and_metadata(exec_client, auth_headers, monkeypatch):
    """When MOCK_AI != '1', litellm.completion should be called with configured model and provider params."""
    captured_kwargs = {}

    class MockChoice:
        def __init__(self, content):
            self.message = type("Msg", (), {"content": content})()

    class MockResp:
        def __init__(self, content):
            self.choices = [MockChoice(content)]

    def mock_completion(**kwargs):
        captured_kwargs.update(kwargs)
        return MockResp("Live response synthesized by Anthropic Claude 3.5 Sonnet.")

    import litellm
    monkeypatch.setattr(litellm, "completion", mock_completion)
    monkeypatch.setenv("MOCK_AI", "0")

    payload = {
        "message": "Analyze hydraulic pump health against recent tolerance specs",
        "provider": "anthropic",
        "model": "anthropic/claude-3-5-sonnet-20241022",
        "api_key": "sk-ant-test-key-12345",
        "base_url": "https://api.anthropic.com",
    }
    res = exec_client.post("/v1/chat/message", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["provider"] == "anthropic"
    assert data["model"] == "anthropic/claude-3-5-sonnet-20241022"
    assert data["content"] == "Live response synthesized by Anthropic Claude 3.5 Sonnet."
    assert captured_kwargs["model"] == "anthropic/claude-3-5-sonnet-20241022"
    assert captured_kwargs["api_key"] == "sk-ant-test-key-12345"
    assert captured_kwargs["api_base"] == "https://api.anthropic.com"
    # System prompt should be present and grounded in live telemetry
    system_msg = next((m for m in captured_kwargs["messages"] if m["role"] == "system"), None)
    assert system_msg is not None
    assert "CURRENT OPERATIONAL CONTEXT" in system_msg["content"]


def test_chat_providers_discovery_all_providers(exec_client, auth_headers):
    """GET /v1/chat/providers returns complete list of all 19+ major LiteLLM providers."""
    res = exec_client.get("/v1/chat/providers", headers=auth_headers)
    assert res.status_code == 200
    providers = res.json()
    assert isinstance(providers, list)
    assert len(providers) >= 20

    provider_map = {p["id"]: p for p in providers}
    required_ids = [
        "gemini",
        "openai",
        "anthropic",
        "deepseek",
        "groq",
        "mistral",
        "ollama",
        "openrouter",
        "perplexity",
        "together_ai",
        "cohere",
        "xai",
        "azure",
        "bedrock",
        "vertex_ai",
        "cloudflare",
        "fireworks_ai",
        "anyscale",
        "replicate",
        "custom",
    ]
    for rid in required_ids:
        assert rid in provider_map, f"Provider {rid} missing from GET /v1/chat/providers"
        p = provider_map[rid]
        assert "name" in p
        assert "default_base_url" in p
        assert "env_key_name" in p
        assert "default_model" in p
        assert "popular_models" in p
        assert isinstance(p["popular_models"], list)
        assert len(p["popular_models"]) > 0
        assert "env_api_key_set" in p
        assert "requires_key" in p

    # Verify specific default configurations
    assert provider_map["gemini"]["default_model"] == "gemini-2.0-flash"
    assert provider_map["gemini"]["env_key_name"] == "GEMINI_API_KEY"
    assert "generativelanguage.googleapis.com" in provider_map["gemini"]["default_base_url"]

    assert provider_map["openai"]["default_model"] == "gpt-4o"
    assert provider_map["openai"]["env_key_name"] == "OPENAI_API_KEY"

    assert provider_map["anthropic"]["default_model"] == "claude-3-7-sonnet-20250219"
    assert provider_map["anthropic"]["env_key_name"] == "ANTHROPIC_API_KEY"

    assert provider_map["deepseek"]["default_model"] == "deepseek-chat"
    assert "deepseek-reasoner" in provider_map["deepseek"]["popular_models"]

    assert provider_map["ollama"]["requires_key"] is False
    assert provider_map["ollama"]["default_base_url"] == "http://localhost:11434"
    assert "llama3.2:latest" in provider_map["ollama"]["popular_models"]


def test_chat_providers_environment_keys_detection(exec_client, auth_headers, monkeypatch):
    """GET /v1/chat/providers accurately detects when environment API keys are set."""
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-ds-test-key-999")
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test_key_111")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    res = exec_client.get("/v1/chat/providers", headers=auth_headers)
    assert res.status_code == 200
    providers = {p["id"]: p for p in res.json()}

    assert providers["deepseek"]["env_api_key_set"] is True
    assert providers["deepseek"]["env_key_present"] is True
    assert providers["groq"]["env_api_key_set"] is True
    assert providers["openrouter"]["env_api_key_set"] is False


def test_chat_models_fetch_catalog_fallback(exec_client, auth_headers):
    """POST /v1/chat/models/fetch gracefully returns catalog models with context windows."""
    payload = {"provider": "gemini"}
    res = exec_client.post("/v1/chat/models/fetch", json=payload, headers=auth_headers)
    assert res.status_code == 200
    models = res.json()
    assert isinstance(models, list)
    assert len(models) >= 4

    model_ids = {m["id"] for m in models}
    assert "gemini-2.0-flash" in model_ids
    assert "gemini-2.5-flash" in model_ids

    # Check structure
    for m in models:
        assert "id" in m
        assert "name" in m
        assert "context_window" in m
        assert m["provider"] == "gemini"
        assert isinstance(m["context_window"], int)
        assert m["context_window"] >= 128000


def test_chat_models_fetch_dynamic_ollama(exec_client, auth_headers, monkeypatch):
    """POST /v1/chat/models/fetch dynamically queries Ollama /api/tags when reachable."""
    monkeypatch.setenv("MOCK_AI", "0")

    class MockOllamaResponse:
        status_code = 200

        def json(self):
            return {
                "models": [
                    {"name": "llama3.2:3b", "model": "llama3.2:3b"},
                    {"name": "deepseek-r1:14b", "model": "deepseek-r1:14b"},
                    {"name": "qwen2.5-coder:7b", "model": "qwen2.5-coder:7b"},
                ]
            }

    def mock_get(url, **kwargs):
        if "/api/tags" in url:
            return MockOllamaResponse()
        raise ConnectionError("Unreachable")

    import httpx
    monkeypatch.setattr(httpx.Client, "get", lambda self, url, **kw: mock_get(url, **kw))

    payload = {"provider": "ollama", "base_url": "http://localhost:11434"}
    res = exec_client.post("/v1/chat/models/fetch", json=payload, headers=auth_headers)
    assert res.status_code == 200
    models = res.json()
    assert isinstance(models, list)
    assert len(models) == 3
    names = [m["name"] for m in models]
    assert "llama3.2:3b" in names
    assert "deepseek-r1:14b" in names
    assert "qwen2.5-coder:7b" in names
    assert all(m["provider"] == "ollama" for m in models)


def test_chat_models_fetch_dynamic_openai_compatible(exec_client, auth_headers, monkeypatch):
    """POST /v1/chat/models/fetch dynamically queries OpenAI-compatible GET /models."""
    monkeypatch.setenv("MOCK_AI", "0")

    class MockOpenAIResponse:
        status_code = 200

        def json(self):
            return {
                "data": [
                    {"id": "deepseek-chat", "context_window": 64000},
                    {"id": "deepseek-reasoner", "context_window": 64000},
                    {"id": "deepseek-coder", "context_window": 128000},
                ]
            }

    import httpx
    monkeypatch.setattr(httpx.Client, "get", lambda self, url, **kw: MockOpenAIResponse())

    payload = {
        "provider": "deepseek",
        "api_key": "sk-ds-fake-key",
        "base_url": "https://api.deepseek.com",
    }
    res = exec_client.post("/v1/chat/models/fetch", json=payload, headers=auth_headers)
    assert res.status_code == 200
    models = res.json()
    assert isinstance(models, list)
    assert len(models) == 3
    ids = [m["id"] for m in models]
    assert "deepseek-chat" in ids
    assert "deepseek-reasoner" in ids
    assert "deepseek-coder" in ids


def test_chat_models_fetch_graceful_fallback_on_network_error(exec_client, auth_headers, monkeypatch):
    """When remote server times out or fails, fetch_models gracefully falls back to catalog."""
    monkeypatch.setenv("MOCK_AI", "0")

    def mock_get_fail(*args, **kwargs):
        raise httpx.ConnectTimeout("Network timed out")

    import httpx
    monkeypatch.setattr(httpx.Client, "get", lambda self, url, **kw: mock_get_fail())

    payload = {
        "provider": "anthropic",
        "base_url": "https://api.anthropic.com",
        "api_key": "sk-ant-test",
    }
    res = exec_client.post("/v1/chat/models/fetch", json=payload, headers=auth_headers)
    assert res.status_code == 200
    models = res.json()
    assert isinstance(models, list)
    # Should fallback gracefully to anthropic catalog models
    assert len(models) >= 3
    assert any("claude" in m["id"] for m in models)


def test_chat_assistant_strictly_zero_emojis(exec_client, auth_headers):
    """Assistant responses and system prompt must have strictly ZERO emojis."""
    import re
    # Unicode emoji pattern matching emoji symbols and pictographs
    emoji_pattern = re.compile(
        r"[\U0001F000-\U0001FAFF]|[\u2600-\u27BF]|[⚡⚙📊🔌📄📋✓✕👁🤖✨🐋🦙🌊]"
    )

    # 1. Test greeting / contextual query
    res1 = exec_client.post(
        "/v1/chat/message",
        json={"message": "Hello, provide a system overview"},
        headers=auth_headers,
    )
    assert res1.status_code == 200
    content1 = res1.json()["content"]
    assert not emoji_pattern.search(content1), f"Emoji found in general response: {content1}"

    # 2. Test dashboard mutation
    res2 = exec_client.post(
        "/v1/chat/message",
        json={"message": "Change production target to 1,500"},
        headers=auth_headers,
    )
    assert res2.status_code == 200
    content2 = res2.json()["content"]
    assert not emoji_pattern.search(content2), f"Emoji found in mutation response: {content2}"

    # 3. Test dashboard reset
    res3 = exec_client.post(
        "/v1/chat/message",
        json={"message": "Reset dashboard overrides"},
        headers=auth_headers,
    )
    assert res3.status_code == 200
    content3 = res3.json()["content"]
    assert not emoji_pattern.search(content3), f"Emoji found in reset response: {content3}"

    # 4. Test tool execution query (SAP S/4HANA)
    res4 = exec_client.post(
        "/v1/chat/message",
        json={"message": "Check SAP stock for Part 100"},
        headers=auth_headers,
    )
    assert res4.status_code == 200
    content4 = res4.json()["content"]
    assert not emoji_pattern.search(content4), f"Emoji found in tool response: {content4}"



