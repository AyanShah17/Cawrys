"""ModelProviderAdapter: the only module that talks to LiteLLM."""
import base64
import json
import logging
import os

from .config import LITELLM_BASE_URL, LITELLM_KEY

os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
logger = logging.getLogger("intelligence.models")


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
    from . import mock

    system = (
        "You extract structured operational data from documents. "
        "Return JSON: {\"doc_type\": str, \"fields\": {name: value}, "
        "\"field_confidence\": {name: 0..1}, \"missing\": [str]}. "
        "Never invent values; use null and list the field in missing."
    )
    try:
        res, trace = _call(model, [{"role": "system", "content": system}, {"role": "user", "content": text[:60000]}])
        if isinstance(res, dict):
            fields = res.get("fields") or {}
            if not fields and text and not text.startswith("[PDF document contains no extractable text"):
                return mock.extract_text(model, text)
            if "full_text_excerpt" not in fields and text and len(text.strip()) >= 15 and res.get("doc_type") != "technical_drawing":
                fields["full_text_excerpt"] = text.strip()[:6000]
                res.setdefault("field_confidence", {})["full_text_excerpt"] = 0.92
            return res, trace
    except Exception as exc:
        logger.warning(f"extract_text LLM fallback to mock extractor: {exc}")
    return mock.extract_text(model, text)


def extract_image(model: str, image: bytes, mime: str) -> tuple[dict, dict]:
    from . import ingest, mock

    ocr_hint = ingest.to_text("image", image)
    b64 = base64.b64encode(image).decode()
    system = (
        "You read technical drawings, forms and images. Return JSON: "
        "{\"doc_type\": str, \"fields\": {name: value}, \"field_confidence\": {name: 0..1}, \"missing\": [str]}. "
        "Never guess dimensions or tolerances; use null and list as missing."
    )
    user_text = "Extract all operational fields and full visible text summary."
    if ocr_hint and not ocr_hint.startswith("[Image"):
        user_text += f"\n\nOCR text detected:\n{ocr_hint[:8000]}"
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": [
            {"type": "text", "text": user_text},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
        ]},
    ]
    try:
        res, trace = _call(model, messages)
        if isinstance(res, dict) and (res.get("fields") or not ocr_hint or ocr_hint.startswith("[Image")):
            return res, trace
    except Exception as exc:
        logger.warning(f"extract_image LLM fallback to OCR mock extractor: {exc}")
    return mock.extract_image(model, image, mime)


def reason(model: str, doc_type: str, fields: dict, validation: dict) -> tuple[dict, dict]:
    from . import mock

    system = (
        "You are an operations reasoning engine. Given validated fields, return JSON: "
        "{\"summary\": str, \"proposed_actions\": [{\"action\": str, \"params\": object, \"risk\": \"low|medium|high\"}], "
        "\"open_questions\": [str]}. Propose only; a human approves. "
        "Never propose direct machine actuation."
    )
    payload = json.dumps({"doc_type": doc_type, "fields": fields, "validation": validation})
    try:
        return _call(model, [{"role": "system", "content": system}, {"role": "user", "content": payload}])
    except Exception as exc:
        logger.warning(f"reason LLM fallback to mock reasoner: {exc}")
        return mock.reason(model, doc_type, fields, validation)


# Prototype mode: swap in deterministic stand-ins (no provider keys).
from .config import MOCK_AI  # noqa: E402

if MOCK_AI:
    from . import mock  # noqa: E402

    extract_text = mock.extract_text
    extract_image = mock.extract_image
    reason = mock.reason
