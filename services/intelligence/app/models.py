"""ModelProviderAdapter: the only module that talks to LiteLLM."""
import base64
import json
import os

from .config import LITELLM_BASE_URL, LITELLM_KEY

os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"


def _call(model: str, messages: list[dict], json_mode: bool = True) -> tuple[dict | str, dict]:
    import litellm

    resp = litellm.completion(
        model=f"openai/{model}",
        api_base=LITELLM_BASE_URL,
        api_key=LITELLM_KEY,
        messages=messages,
        response_format={"type": "json_object"} if json_mode else None,
        temperature=0,
    )
    text = resp.choices[0].message.content or ""
    usage = getattr(resp, "usage", None)
    trace = {
        "model": model,
        "tokens": getattr(usage, "total_tokens", None) if usage else None,
    }
    return (json.loads(text) if json_mode else text), trace


def extract_text(model: str, text: str) -> tuple[dict, dict]:
    system = (
        "You extract structured operational data from documents. "
        "Return JSON: {\"doc_type\": str, \"fields\": {name: value}, "
        "\"field_confidence\": {name: 0..1}, \"missing\": [str]}. "
        "Never invent values; use null and list the field in missing."
    )
    return _call(model, [{"role": "system", "content": system}, {"role": "user", "content": text[:60000]}])


def extract_image(model: str, image: bytes, mime: str) -> tuple[dict, dict]:
    b64 = base64.b64encode(image).decode()
    system = (
        "You read technical drawings, forms and images. Return JSON: "
        "{\"doc_type\": str, \"fields\": {name: value}, \"field_confidence\": {name: 0..1}, \"missing\": [str]}. "
        "Never guess dimensions or tolerances; use null and list as missing."
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": [
            {"type": "text", "text": "Extract all operational fields."},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
        ]},
    ]
    return _call(model, messages)


def reason(model: str, doc_type: str, fields: dict, validation: dict) -> tuple[dict, dict]:
    system = (
        "You are an operations reasoning engine. Given validated fields, return JSON: "
        "{\"summary\": str, \"proposed_actions\": [{\"action\": str, \"params\": object, \"risk\": \"low|medium|high\"}], "
        "\"open_questions\": [str]}. Propose only; a human approves. "
        "Never propose direct machine actuation."
    )
    payload = json.dumps({"doc_type": doc_type, "fields": fields, "validation": validation})
    return _call(model, [{"role": "system", "content": system}, {"role": "user", "content": payload}])


# Prototype mode: swap in deterministic stand-ins (no provider keys).
from .config import MOCK_AI  # noqa: E402

if MOCK_AI:
    from . import mock  # noqa: E402

    extract_text = mock.extract_text
    extract_image = mock.extract_image
    reason = mock.reason
