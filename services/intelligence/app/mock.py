"""Deterministic stand-ins for the model calls so the prototype runs without provider keys.

Same signatures and return shapes as models.py. Only used when MOCK_AI=1 or as offline fallback.
"""
import re

from . import ingest

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
    clean_text = (text or "").strip()

    # Check if extraction actually failed / yielded placeholder text
    is_placeholder = clean_text.startswith((
        "[PDF document contains no extractable text",
        "[PDF text extraction failed",
        "[Image document contains no extractable text",
        "[DOCX text extraction failed",
        "[Unsupported",
    ))

    for raw_line in clean_text.splitlines():
        # OCR outputs rows joined with ' | '; inspect both full line and pipe segments
        segments = [seg.strip() for seg in raw_line.split("|") if seg.strip()]
        for seg in (segments if len(segments) > 1 else [raw_line]):
            m = re.match(r"\s*([A-Za-z][A-Za-z0-9 _/().'-]{1,42}?)\s*[:=]\s*(.+?)\s*$", seg)
            if m:
                key = re.sub(r"[^a-z0-9]+", "_", m.group(1).lower()).strip("_")
                if key and not key.startswith("---"):
                    val_str = m.group(2).strip()
                    if val_str:
                        fields[key] = _coerce(val_str)
                        conf[key] = 0.95

    is_drawing = "drawing" in clean_text.lower() or "drawing_id" in fields
    doc_type = "technical_drawing" if is_drawing else "document"
    missing = [k for k in EXPECTED_FOR_DRAWING if k not in fields] if is_drawing else []

    # For general/OCR/academic/prose documents (not strictly compact technical drawings),
    # always retain document title, concise summary, and extracted text content so LLMs and chat
    # have full visibility into the file even when regex Key: Value pairs matched.
    if not is_placeholder and len(clean_text) >= 15:
        non_empty_lines = [
            ln.strip()
            for ln in clean_text.splitlines()
            if ln.strip() and not ln.strip().startswith("--- Page ")
        ]
        if not is_drawing or not fields or "drawing_id" not in fields:
            if non_empty_lines and "document_title" not in fields:
                fields["document_title"] = non_empty_lines[0][:220]
                conf["document_title"] = 0.92
            if non_empty_lines and "summary" not in fields:
                preview_lines = non_empty_lines[:10]
                fields["summary"] = " ; ".join(preview_lines)[:600]
                conf["summary"] = 0.92
            fields["line_count"] = len(non_empty_lines)
            conf["line_count"] = 0.96
            fields["full_text_excerpt"] = clean_text[:8000]
            conf["full_text_excerpt"] = 0.94
        elif len(non_empty_lines) > 6 and "full_text_excerpt" not in fields:
            fields["full_text_excerpt"] = clean_text[:8000]
            conf["full_text_excerpt"] = 0.94

    return (
        {"doc_type": doc_type, "fields": fields, "field_confidence": conf, "missing": missing},
        {"model": f"mock:{model}", "tokens": 0},
    )


def extract_image(model: str, image: bytes, mime: str):
    ocr_text = ingest.to_text("image", image)
    if ocr_text and not ocr_text.startswith("[Image"):
        res, trace = extract_text(model, ocr_text)
        res["doc_type"] = res.get("doc_type") or "image"
        return res, trace
    return (
        {"doc_type": "image", "fields": {}, "field_confidence": {}, "missing": ["vision_model_required"]},
        {"model": f"mock:{model}", "tokens": 0},
    )


def reason(model: str, doc_type: str, fields: dict, validation: dict):
    actions = []
    if doc_type == "technical_drawing" and not validation.get("issues"):
        actions.append({"action": "run_playbook:production-setup", "params": fields, "risk": "medium"})
    questions = [f"Resolve: {i.get('type', 'validation_issue')}" for i in validation.get("issues", [])]
    summary = fields.get("summary") or f"{doc_type} with {len(fields)} extracted fields."
    return (
        {
            "summary": summary,
            "proposed_actions": actions,
            "open_questions": questions,
        },
        {"model": f"mock:{model}", "tokens": 0},
    )
