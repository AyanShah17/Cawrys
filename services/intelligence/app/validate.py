"""Deterministic validation: no model involved."""
from .config import CONFIDENCE_THRESHOLD


def validate(fields: dict, field_confidence: dict, missing: list[str]) -> dict:
    low = {k: c for k, c in field_confidence.items() if c is not None and c < CONFIDENCE_THRESHOLD}
    nulls = [k for k, v in fields.items() if v is None]
    issues = []
    if missing:
        issues.append({"type": "missing_fields", "fields": missing})
    if low:
        issues.append({"type": "low_confidence", "fields": low})
    for k, v in fields.items():
        if isinstance(v, (int, float)) and v < 0 and any(t in k.lower() for t in ("dimension", "length", "width", "qty", "quantity")):
            issues.append({"type": "negative_value", "field": k, "value": v})

    scores = [c for c in field_confidence.values() if isinstance(c, (int, float))]
    overall = round(sum(scores) / len(scores), 3) if scores else 0.0
    return {
        "issues": issues,
        "null_fields": nulls,
        "overall_confidence": overall,
        "passed": not issues,
        "needs_review": bool(issues) or overall < CONFIDENCE_THRESHOLD,
    }
