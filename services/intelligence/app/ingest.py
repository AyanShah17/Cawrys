import io
import logging

logger = logging.getLogger("intelligence.ingest")

IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


def kind(mime: str, filename: str) -> str:
    name = filename.lower()
    if mime in IMAGE_TYPES or name.endswith((".png", ".jpg", ".jpeg", ".webp")):
        return "image"
    if mime == "application/pdf" or name.endswith(".pdf"):
        return "pdf"
    if name.endswith(".docx"):
        return "docx"
    return "text"


def to_text(k: str, data: bytes) -> str:
    if k == "pdf":
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            if getattr(reader, "is_encrypted", False):
                try:
                    # Attempt decrypt with empty password (common in standard PDF security)
                    reader.decrypt("")
                except Exception as dec_err:
                    logger.debug(f"PDF decrypt attempt with default password: {dec_err}")

            pages_text = []
            for p in reader.pages:
                try:
                    txt = p.extract_text() or ""
                    if txt:
                        pages_text.append(txt)
                except Exception as page_err:
                    logger.warning(f"Failed extracting text from PDF page: {page_err}")
                    continue

            extracted = "\n".join(pages_text).strip()
            if extracted:
                return extracted
            return "[PDF document contains no extractable text or is image-based]"
        except Exception as e:
            logger.warning(f"PDF extraction fallback: {e}")
            return f"[PDF text extraction failed: {type(e).__name__} - {e}]"

    if k == "docx":
        try:
            from docx import Document

            doc = Document(io.BytesIO(data))
            return "\n".join(p.text for p in doc.paragraphs)
        except Exception as e:
            logger.warning(f"DOCX extraction fallback: {e}")
            return f"[DOCX text extraction failed: {type(e).__name__} - {e}]"

    return data.decode("utf-8", errors="replace")
