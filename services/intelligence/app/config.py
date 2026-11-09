import os

DATABASE_URL = os.environ.get("NEON_DATABASE_URL") or os.environ.get("DATABASE_URL") or ""
LITELLM_BASE_URL = os.environ.get("LITELLM_BASE_URL", "http://localhost:4000")
LITELLM_KEY = os.environ.get("LITELLM_MASTER_KEY", "")
MODEL_EXTRACT = os.environ.get("MODEL_EXTRACT", "cawrys-extract")
MODEL_VISION = os.environ.get("MODEL_VISION", "cawrys-vision")
MODEL_REASON = os.environ.get("MODEL_REASON", "cawrys-reason")

R2_ENDPOINT = os.environ.get("R2_ENDPOINT", "")
R2_KEY = os.environ.get("R2_ACCESS_KEY_ID", "")
R2_SECRET = os.environ.get("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.environ.get("R2_BUCKET", "cawrys-files")

DEFAULT_TENANT = "00000000-0000-0000-0000-000000000001"
CONFIDENCE_THRESHOLD = 0.8

# Prototype mode: no provider keys needed. Extraction/reasoning use deterministic stand-ins.
def _is_truthy(val: str | None) -> bool:
    if not val:
        return False
    return val.strip().lower() in ("1", "true", "yes", "on")


_mock_ai_env = os.environ.get("MOCK_AI")
_gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()

if _mock_ai_env is not None and _mock_ai_env.strip() != "":
    MOCK_AI = _is_truthy(_mock_ai_env)
else:
    # Auto-activate when GEMINI_API_KEY is not provided or empty
    MOCK_AI = not bool(_gemini_key)
