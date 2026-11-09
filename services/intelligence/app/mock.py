"""Deterministic stand-ins for the model calls so the prototype runs without provider keys.

Same signatures and return shapes as models.py. Only used when MOCK_AI=1.
"""
import re

EXPECTED_FOR_DRAWING = ["drawing_id", "material", "quantity"]


def _coerce(v: str):
    v = v.strip()
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        return v


def extract_text(model: str, text: str):
    fields, conf = {}, {}
    for line in text.splitlines():
        m = re.match(r"\s*([A-Za-z][A-Za-z0-9 _/().-]{1,40}?)\s*[:=]\s*(.+?)\s*$", line)
        if m:
            key = re.sub(r"[^a-z0-9]+", "_", m.group(1).lower()).strip("_")
            fields[key] = _coerce(m.group(2))
            conf[key] = 0.95
    is_drawing = "drawing" in text.lower() or "drawing_id" in fields
    doc_type = "technical_drawing" if is_drawing else "document"
    missing = [k for k in EXPECTED_FOR_DRAWING if k not in fields] if is_drawing else []
    return (
        {"doc_type": doc_type, "fields": fields, "field_confidence": conf, "missing": missing},
        {"model": f"mock:{model}", "tokens": 0},
    )


def extract_image(model: str, image: bytes, mime: str):
    return (
        {"doc_type": "image", "fields": {}, "field_confidence": {}, "missing": ["vision_model_required"]},
        {"model": f"mock:{model}", "tokens": 0},
    )


def reason(model: str, doc_type: str, fields: dict, validation: dict):
    actions = []
    if doc_type == "technical_drawing" and not validation.get("issues"):
        actions.append({"action": "run_playbook:production-setup", "params": fields, "risk": "medium"})
    questions = [f"Resolve: {i.get('type', 'validation_issue')}" for i in validation.get("issues", [])]
    return (
        {
            "summary": f"{doc_type} with {len(fields)} extracted fields.",
            "proposed_actions": actions,
            "open_questions": questions,
        },
        {"model": f"mock:{model}", "tokens": 0},
    )
