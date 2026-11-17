"""MarkItDown and MarkItDown OCR document conversion and caching utilities.

Converts PDFs (digital and scanned via macOS Vision OCR), images, DOCX, and
plain-text/structured files into clean GitHub Flavored Markdown (.md) and
persists cached Markdown artifacts in storage and extraction records.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import ingest, storage

logger = logging.getLogger("intelligence.markitdown")

_REPO_ROOT = Path(__file__).resolve().parents[3]
_EMOJI_RE = re.compile(
    r"[\U0001F000-\U0001FFFF\u2600-\u27BF\u2300-\u23FF\u2B50\u2B55\uFE00-\uFE0F]"
)
_PAGE_MARKER_RE = re.compile(r"^---\s*Page\s+(\d+)\s+of\s+\d+\s*---\s*$", re.IGNORECASE)
_PLACEHOLDER_PREFIXES = (
    "[pdf document contains no extractable text",
    "[pdf text extraction failed",
    "[image document contains no extractable text",
    "[docx text extraction failed",
    "[unsupported",
    "[empty document]",
    "[source file bytes unavailable",
    "[ocr disabled",
)


def _strip_emojis(text: str) -> str:
    """Removes Unicode emoji symbols to enforce zero-emoji Markdown output."""
    return _EMOJI_RE.sub("", text or "")


def _normalize_text(text: str) -> str:
    """Normalizes line endings, non-breaking spaces, and excessive blank lines."""
    cleaned = (text or "").replace("\r\n", "\n").replace("\r", "\n").replace("\xa0", " ")
    lines = [ln.rstrip() for ln in cleaned.splitlines()]
    normalized = "\n".join(lines).strip()
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return _strip_emojis(normalized)


def _is_placeholder_text(text: str) -> bool:
    """Returns True when extracted text is empty or only a failure placeholder."""
    lower = (text or "").strip().lower()
    if not lower:
        return True
    return lower.startswith(_PLACEHOLDER_PREFIXES)


def _extract_body_excerpt(md_text: str) -> str:
    """Strips Markdown header and metadata bullets to produce a plain text excerpt."""
    lines = (md_text or "").splitlines()
    body_lines: List[str] = []
    in_header = True
    for ln in lines:
        s = ln.strip()
        if in_header:
            if not s or s.startswith("# ") or s.startswith("- **Kind**:") or s.startswith("- **OCR Used**:") or s.startswith("- **Pages**:"):
                continue
            in_header = False
        if re.fullmatch(r"##\s+(?:Page\s+\d+|Document Content|Extracted Fields)", s):
            continue
        body_lines.append(ln)
    return _normalize_text("\n".join(body_lines))


def _is_placeholder_markdown(md_text: str) -> bool:
    """Returns True when Markdown content is missing or contains only a failure placeholder."""
    if not md_text or not md_text.strip():
        return True
    if _is_placeholder_text(md_text):
        return True
    body = _extract_body_excerpt(md_text)
    return _is_placeholder_text(body)


def _safe_filename(filename: str) -> str:
    base = os.path.basename((filename or "document").replace("\\", "/")).strip()
    return base or "document"


def _detect_kind(mime_type: str, filename: str) -> str:
    return ingest.kind(mime_type or "", filename or "document")


def _try_markitdown(data: bytes, filename: str, mime_type: str = "") -> Optional[str]:
    """Attempts conversion via markitdown.MarkItDown when the optional package is installed."""
    try:
        from markitdown import MarkItDown  # type: ignore
    except ImportError:
        return None

    ext = Path(filename or "upload").suffix.lower() or ""
    try:
        engine = MarkItDown()
    except Exception:
        return None

    res = None
    if hasattr(engine, "convert_stream"):
        try:
            res = engine.convert_stream(io.BytesIO(data), file_extension=ext or None)
        except TypeError:
            try:
                res = engine.convert_stream(io.BytesIO(data))
            except Exception:
                res = None
        except Exception:
            res = None

    if res is None and hasattr(engine, "convert"):
        tmp_path: Optional[Path] = None
        try:
            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                tmp.write(data)
                tmp_path = Path(tmp.name)
            res = engine.convert(str(tmp_path))
        except Exception:
            res = None
        finally:
            if tmp_path is not None:
                try:
                    tmp_path.unlink(missing_ok=True)
                except OSError:
                    pass

    if res is None:
        return None

    raw = getattr(res, "markdown", None) or getattr(res, "text_content", None)
    if raw is None and isinstance(res, str):
        raw = res
    cleaned = _normalize_text(str(raw or ""))
    return cleaned or None


def _format_markdown(
    filename: str,
    doc_kind: str,
    ocr_used: bool,
    page_count: int,
    sections: List[Tuple[str, str]],
) -> str:
    """Formats extracted sections into clean GitHub Flavored Markdown without emojis."""
    safe_name = _strip_emojis(_safe_filename(filename))
    lines = [
        f"# {safe_name}",
        "",
        f"- **Kind**: {doc_kind}",
        f"- **OCR Used**: {'Yes' if ocr_used else 'No'}",
        f"- **Pages**: {page_count}",
        "",
    ]
    for heading, body in sections:
        clean_heading = _strip_emojis(heading.strip()) or "Document Content"
        clean_body = _normalize_text(body)
        if not clean_body:
            continue
        lines.append(f"## {clean_heading}")
        lines.append("")
        lines.append(clean_body)
        lines.append("")

    return _strip_emojis("\n".join(lines).rstrip() + "\n")


class MarkItDownOCR:
    """OCR adapter wrapping macOS Vision OCR for scanned PDFs and image documents."""

    @staticmethod
    def ocr_bytes(data: bytes, mode: str, ext: str = ".bin", max_pages: int = 12) -> str:
        """Runs Vision OCR via ingest._ocr_pdf_or_image_bytes for PDF or image payloads."""
        if not data:
            return ""
        try:
            raw = ingest._ocr_pdf_or_image_bytes(data, mode=mode, ext=ext, max_pages=max_pages)
            return _normalize_text(raw)
        except Exception as exc:
            logger.debug(f"MarkItDownOCR execution skipped/failed: {exc}")
            return ""

    @staticmethod
    def ocr_pdf(data: bytes, max_pages: int = 12) -> str:
        """Runs Vision OCR across pages of a scanned or image-based PDF."""
        return MarkItDownOCR.ocr_bytes(data, mode="pdf", ext=".pdf", max_pages=max_pages)

    @staticmethod
    def ocr_image(data: bytes, filename: str = "image.png", mime_type: str = "") -> str:
        """Runs Vision OCR on an image payload."""
        ext = Path(_safe_filename(filename)).suffix.lower()
        if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"):
            if "jpeg" in (mime_type or "").lower() or "jpg" in (mime_type or "").lower():
                ext = ".jpg"
            else:
                ext = ".png"
        return MarkItDownOCR.ocr_bytes(data, mode="image", ext=ext, max_pages=1)

    @staticmethod
    def parse_ocr_pages(ocr_text: str) -> List[Tuple[int, str]]:
        """Splits Vision OCR output into (page_number, content) tuples."""
        cleaned = _normalize_text(ocr_text)
        if not cleaned:
            return []

        pages: List[Tuple[int, str]] = []
        current_page: Optional[int] = None
        current_lines: List[str] = []

        for line in cleaned.splitlines():
            m = _PAGE_MARKER_RE.match(line.strip())
            if m:
                if current_page is not None and current_lines:
                    pages.append((current_page, "\n".join(current_lines).strip()))
                current_page = int(m.group(1))
                current_lines = []
            else:
                current_lines.append(line)

        if current_page is not None:
            if current_lines:
                pages.append((current_page, "\n".join(current_lines).strip()))
        elif cleaned:
            pages.append((1, cleaned))

        return [(p, txt) for p, txt in pages if txt]


def _extract_pdf_sections(
    data: bytes,
    filename: str,
    mime_type: str,
    use_ocr: bool,
) -> Tuple[List[Tuple[str, str]], bool, int]:
    """Extracts page-by-page PDF sections with MarkItDown/pypdf and Vision OCR fallback."""
    page_texts: List[Tuple[int, str]] = []
    page_count = 0
    raw_non_ws = 0
    pypdf_err: Optional[str] = None

    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        if getattr(reader, "is_encrypted", False):
            try:
                reader.decrypt("")
            except Exception as dec_err:
                logger.debug(f"PDF decrypt attempt failed: {dec_err}")

        page_count = len(reader.pages)
        for idx, page in enumerate(reader.pages, start=1):
            try:
                txt = _normalize_text(page.extract_text() or "")
            except Exception as page_err:
                logger.warning(f"Failed extracting text from PDF page {idx}: {page_err}")
                txt = ""
            if txt:
                raw_non_ws += len("".join(txt.split()))
                page_texts.append((idx, txt))
    except Exception as exc:
        pypdf_err = f"{type(exc).__name__} - {exc}"
        logger.warning(f"pypdf extraction fallback for {filename}: {pypdf_err}")

    if raw_non_ws >= 40 and page_texts:
        sections = [(f"Page {idx}", txt) for idx, txt in page_texts]
        return sections, False, max(page_count, len(sections))

    md_fallback = _try_markitdown(data, filename, mime_type)
    if md_fallback and len("".join(md_fallback.split())) >= 40 and not _is_placeholder_text(md_fallback):
        return [("Document Content", md_fallback)], False, max(page_count, 1)

    if use_ocr:
        ocr_raw = MarkItDownOCR.ocr_pdf(data, max_pages=12)
        if ocr_raw and len("".join(ocr_raw.split())) >= 10 and not _is_placeholder_text(ocr_raw):
            ocr_pages = MarkItDownOCR.parse_ocr_pages(ocr_raw)
            if ocr_pages:
                sections = [(f"Page {pnum}", ptxt) for pnum, ptxt in ocr_pages]
                return sections, True, max(page_count, len(sections))

    if page_texts and raw_non_ws > 0:
        sections = [(f"Page {idx}", txt) for idx, txt in page_texts]
        return sections, False, max(page_count, len(sections))

    if pypdf_err:
        return [("Document Content", f"[PDF text extraction failed: {pypdf_err}]")], False, page_count
    return [("Document Content", "[PDF document contains no extractable text or is image-based]")], False, page_count


def _extract_docx_sections(data: bytes, filename: str, mime_type: str) -> List[Tuple[str, str]]:
    """Extracts DOCX paragraphs and tables as clean GitHub Flavored Markdown."""
    md_fallback = _try_markitdown(data, filename, mime_type)
    if md_fallback and not _is_placeholder_text(md_fallback):
        return [("Document Content", md_fallback)]

    try:
        from docx import Document

        doc = Document(io.BytesIO(data))
        blocks: List[str] = [p.text.strip() for p in doc.paragraphs if p.text and p.text.strip()]
        for table in doc.tables:
            rows_md: List[str] = []
            for row_idx, row in enumerate(table.rows):
                cells = [c.text.strip().replace("\n", " ").replace("|", "\\|") for c in row.cells]
                if not any(cells):
                    continue
                rows_md.append("| " + " | ".join(cells) + " |")
                if row_idx == 0:
                    rows_md.append("| " + " | ".join(["---"] * len(cells)) + " |")
            if rows_md:
                blocks.append("\n".join(rows_md))

        content = "\n\n".join(blocks).strip()
        if not content:
            content = "[DOCX document contains no extractable text]"
        return [("Document Content", content)]
    except Exception as exc:
        logger.warning(f"DOCX extraction fallback for {filename}: {exc}")
        return [("Document Content", f"[DOCX text extraction failed: {type(exc).__name__} - {exc}]")]


def _format_text_payload(data: bytes, filename: str, mime_type: str) -> str:
    """Formats text, markdown, JSON, and CSV payloads into clean GFM text."""
    ext = Path(_safe_filename(filename)).suffix.lower()
    if ext not in (".txt", ".md", ".markdown", ".json", ".csv", ".log", ".prt"):
        md_fallback = _try_markitdown(data, filename, mime_type)
        if md_fallback and not _is_placeholder_text(md_fallback):
            return md_fallback

    decoded = _normalize_text(data.decode("utf-8", errors="replace"))
    if not decoded:
        return "[Empty document]"

    if ext == ".json" or mime_type.lower().strip() == "application/json":
        try:
            parsed = json.loads(decoded)
            pretty = json.dumps(parsed, indent=2, ensure_ascii=True)
            return f"```json\n{pretty}\n```"
        except Exception:
            return decoded

    if ext == ".csv" or mime_type.lower().strip() == "text/csv":
        try:
            rows = list(csv.reader(io.StringIO(decoded)))
            if rows and len(rows) <= 200 and len(rows[0]) >= 2:
                width = len(rows[0])
                norm_rows = [
                    [(r[i] if i < len(r) else "").strip().replace("|", "\\|") for i in range(width)]
                    for r in rows
                    if any(cell.strip() for cell in r)
                ]
                if norm_rows:
                    table_lines = [
                        "| " + " | ".join(norm_rows[0]) + " |",
                        "| " + " | ".join(["---"] * width) + " |",
                    ]
                    for r in norm_rows[1:]:
                        table_lines.append("| " + " | ".join(r) + " |")
                    return "\n".join(table_lines)
        except Exception:
            pass

    return decoded


def _read_from_storage_or_local(key: str) -> Optional[bytes]:
    """Loads bytes from active storage provider, falling back to local data directories."""
    if not key:
        return None
    try:
        raw = storage.get(key)
        if raw is not None:
            return raw
    except Exception:
        pass

    candidate_dirs = [
        Path("data/files"),
        Path("uploaded_pdfs"),
        _REPO_ROOT / "data" / "files",
        _REPO_ROOT / "uploaded_pdfs",
    ]
    seen: set[Path] = set()
    for base_dir in candidate_dirs:
        try:
            resolved = base_dir.resolve()
        except Exception:
            continue
        if resolved in seen or not resolved.exists():
            continue
        seen.add(resolved)
        try:
            raw = storage.LocalStorageProvider(resolved).get(key)
            if raw is not None:
                return raw
        except Exception:
            continue
    return None


def _parse_fields(raw_fields: Any) -> Dict[str, Any]:
    if isinstance(raw_fields, dict):
        return dict(raw_fields)
    if isinstance(raw_fields, str):
        try:
            parsed = json.loads(raw_fields)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return {}


def _fields_to_markdown(filename: str, doc_kind: str, fields: Dict[str, Any]) -> str:
    """Builds fallback Markdown from extracted fields when source bytes are absent."""
    excerpt = str(fields.get("full_text_excerpt") or "").strip()
    if excerpt and not _is_placeholder_text(excerpt):
        ocr_flag = doc_kind in ("pdf", "image") and bool(fields.get("ocr_used", False))
        return _format_markdown(filename, doc_kind, ocr_flag, 1, [("Document Content", excerpt)])

    bullet_lines = []
    for k, v in fields.items():
        if k in ("markdown_key", "markdown_content", "full_text_excerpt"):
            continue
        bullet_lines.append(f"- **{k}**: {v}")
    body = "\n".join(bullet_lines) if bullet_lines else "[Source file bytes unavailable in storage]"
    section_title = "Extracted Fields" if bullet_lines else "Document Content"
    return _format_markdown(filename, doc_kind, False, 0 if not bullet_lines else 1, [(section_title, body)])


def _persist_extraction_markdown(
    c: Any,
    tenant_id: str,
    doc_id: str,
    filename: str,
    doc_type: Optional[str],
    confidence: Optional[float],
    fields: Dict[str, Any],
) -> None:
    """Persists updated Markdown fields back to the extractions table (SQLite and Postgres)."""
    if c is None or not doc_id:
        return
    try:
        existing = c.execute(
            "SELECT id FROM extractions WHERE document_id=%s AND tenant_id=%s",
            (doc_id, tenant_id),
        ).fetchone()
        if existing:
            c.execute(
                "UPDATE extractions SET fields=%s WHERE document_id=%s AND tenant_id=%s",
                (json.dumps(fields), doc_id, tenant_id),
            )
        else:
            conf_val = float(confidence) if confidence is not None else 0.92
            validation = {
                "issues": [],
                "overall_confidence": conf_val,
                "passed": True,
                "needs_review": False,
            }
            decision = {
                "summary": f"Converted {filename} to Markdown",
                "proposed_actions": [],
                "open_questions": [],
            }
            c.execute(
                "INSERT INTO extractions "
                "(id, document_id, tenant_id, doc_type, fields, confidence, validation, decision, requires_approval, model_trace) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    str(uuid.uuid4()),
                    doc_id,
                    tenant_id,
                    doc_type or "document",
                    json.dumps(fields),
                    conf_val,
                    json.dumps(validation),
                    json.dumps(decision),
                    True,
                    json.dumps([]),
                ),
            )
        c.commit()
    except Exception as exc:
        logger.debug(f"Could not persist markdown fields for document {doc_id}: {exc}")


class MarkItDownConverter:
    """Converts uploaded documents to GitHub Flavored Markdown with Vision OCR and caching."""

    ocr = MarkItDownOCR

    @staticmethod
    def convert_bytes_to_markdown(
        data: bytes,
        filename: str,
        mime_type: str = "",
        use_ocr: bool = True,
    ) -> Dict[str, Any]:
        """Converts raw document bytes into clean GFM Markdown and conversion metadata."""
        safe_name = _safe_filename(filename)
        doc_kind = _detect_kind(mime_type, safe_name)

        if not data:
            md_empty = _format_markdown(
                safe_name, doc_kind, False, 0, [("Document Content", "[Empty document]")]
            )
            return {
                "markdown": md_empty,
                "ocr_used": False,
                "page_count": 0,
                "kind": doc_kind,
            }

        if doc_kind == "image":
            ocr_used = False
            if use_ocr:
                ocr_text = MarkItDownOCR.ocr_image(data, filename=safe_name, mime_type=mime_type)
                if ocr_text and not _is_placeholder_text(ocr_text):
                    ocr_used = True
                    body = ocr_text
                else:
                    md_fallback = _try_markitdown(data, safe_name, mime_type)
                    body = (
                        md_fallback
                        if (md_fallback and not _is_placeholder_text(md_fallback))
                        else "[Image document contains no extractable text]"
                    )
            else:
                md_fallback = _try_markitdown(data, safe_name, mime_type)
                body = (
                    md_fallback
                    if (md_fallback and not _is_placeholder_text(md_fallback))
                    else "[Image document contains no extractable text]"
                )
            md_text = _format_markdown(safe_name, doc_kind, ocr_used, 1, [("Document Content", body)])
            return {"markdown": md_text, "ocr_used": ocr_used, "page_count": 1, "kind": doc_kind}

        if doc_kind == "pdf":
            sections, ocr_used, page_count = _extract_pdf_sections(data, safe_name, mime_type, use_ocr)
            md_text = _format_markdown(safe_name, doc_kind, ocr_used, page_count, sections)
            return {
                "markdown": md_text,
                "ocr_used": ocr_used,
                "page_count": page_count,
                "kind": doc_kind,
            }

        if doc_kind == "docx":
            sections = _extract_docx_sections(data, safe_name, mime_type)
            md_text = _format_markdown(safe_name, doc_kind, False, 1, sections)
            return {"markdown": md_text, "ocr_used": False, "page_count": 1, "kind": doc_kind}

        body = _format_text_payload(data, safe_name, mime_type)
        md_text = _format_markdown(safe_name, doc_kind, False, 1, [("Document Content", body)])
        return {"markdown": md_text, "ocr_used": False, "page_count": 1, "kind": doc_kind}

    @staticmethod
    def get_markdown_storage_key(tenant_id: str, doc_id: str, filename: str) -> str:
        """Builds deterministic .md storage key for a tenant document."""
        clean_name = _safe_filename(filename)
        stem = Path(clean_name).stem or "document"
        return f"{tenant_id}/{doc_id}/{stem}.md"

    @staticmethod
    def ensure_document_markdown(
        c: Any,
        tenant_id: str,
        doc_row: Dict[str, Any],
        persist: bool = True,
    ) -> Dict[str, Any]:
        """Ensures a document has cached GFM Markdown, converting lazily from storage if needed."""
        row = dict(doc_row or {})
        doc_id = str(row.get("id") or row.get("document_id") or "").strip()
        filename = _safe_filename(str(row.get("filename") or "document"))
        mime_type = str(row.get("mime_type") or "application/octet-stream")
        doc_type = row.get("doc_type") or "document"
        status = str(row.get("status") or "ready")
        raw_conf = row.get("confidence")
        confidence = float(raw_conf) if raw_conf is not None else None
        storage_key = str(row.get("storage_key") or "").strip() or (
            f"{tenant_id}/{doc_id}/{filename}" if doc_id else filename
        )

        fields = _parse_fields(row.get("fields"))
        markdown_key = str(fields.get("markdown_key") or "").strip() or get_markdown_storage_key(
            tenant_id, doc_id or "doc", filename
        )

        existing_md = str(fields.get("markdown_content") or "").strip()
        if existing_md and not _is_placeholder_markdown(existing_md):
            fields["markdown_key"] = markdown_key
            fields["markdown_content"] = existing_md[:24000]
            ocr_used = bool(fields.get("ocr_used")) or ("- **OCR Used**: Yes" in existing_md)
            return {
                "id": doc_id,
                "filename": filename,
                "doc_type": doc_type,
                "status": status,
                "confidence": confidence,
                "markdown_key": markdown_key,
                "markdown_content": existing_md,
                "fields": fields,
                "ocr_used": ocr_used,
            }

        cached_bytes = _read_from_storage_or_local(markdown_key)
        if cached_bytes is not None:
            cached_md = _normalize_text(cached_bytes.decode("utf-8", errors="replace"))
            if cached_md and not _is_placeholder_markdown(cached_md):
                ocr_used = "- **OCR Used**: Yes" in cached_md
                fields["markdown_key"] = markdown_key
                fields["markdown_content"] = cached_md[:24000]
                if not fields.get("full_text_excerpt") or _is_placeholder_text(
                    str(fields.get("full_text_excerpt") or "")
                ):
                    excerpt = _extract_body_excerpt(cached_md)
                    if excerpt and not _is_placeholder_text(excerpt):
                        fields["full_text_excerpt"] = excerpt[:8000]
                if persist and c is not None and doc_id:
                    _persist_extraction_markdown(
                        c, tenant_id, doc_id, filename, doc_type, confidence, fields
                    )
                return {
                    "id": doc_id,
                    "filename": filename,
                    "doc_type": doc_type,
                    "status": status,
                    "confidence": confidence,
                    "markdown_key": markdown_key,
                    "markdown_content": cached_md,
                    "fields": fields,
                    "ocr_used": ocr_used,
                }

        raw_bytes = _read_from_storage_or_local(storage_key)
        if raw_bytes is None and doc_id:
            fallback_key = f"{tenant_id}/{doc_id}/{filename}"
            if fallback_key != storage_key:
                raw_bytes = _read_from_storage_or_local(fallback_key)

        ocr_used = False
        if raw_bytes is not None:
            conv = convert_bytes_to_markdown(raw_bytes, filename, mime_type, use_ocr=True)
            md_text = str(conv.get("markdown") or "").strip()
            ocr_used = bool(conv.get("ocr_used"))

            if _is_placeholder_markdown(md_text) and not _is_placeholder_text(
                str(fields.get("full_text_excerpt") or "")
            ):
                md_text = _fields_to_markdown(filename, _detect_kind(mime_type, filename), fields)
                ocr_used = bool(fields.get("ocr_used", False))

            if md_text and not _is_placeholder_markdown(md_text):
                try:
                    storage.put(markdown_key, md_text.encode("utf-8"), "text/markdown")
                except Exception:
                    pass
                fields["markdown_key"] = markdown_key
                fields["markdown_content"] = md_text[:24000]
                body_excerpt = _extract_body_excerpt(md_text)[:8000]
                if body_excerpt and not _is_placeholder_text(body_excerpt):
                    existing_excerpt = str(fields.get("full_text_excerpt") or "")
                    if (
                        not existing_excerpt
                        or _is_placeholder_text(existing_excerpt)
                        or len(body_excerpt) > len(existing_excerpt)
                    ):
                        fields["full_text_excerpt"] = body_excerpt
                if persist and c is not None and doc_id:
                    _persist_extraction_markdown(
                        c, tenant_id, doc_id, filename, doc_type, confidence, fields
                    )
        else:
            doc_kind = _detect_kind(mime_type, filename)
            md_text = _fields_to_markdown(filename, doc_kind, fields)
            if not _is_placeholder_markdown(md_text):
                fields["markdown_key"] = markdown_key
                fields["markdown_content"] = md_text[:24000]
                if persist and c is not None and doc_id:
                    _persist_extraction_markdown(
                        c, tenant_id, doc_id, filename, doc_type, confidence, fields
                    )

        return {
            "id": doc_id,
            "filename": filename,
            "doc_type": doc_type,
            "status": status,
            "confidence": confidence,
            "markdown_key": markdown_key,
            "markdown_content": md_text,
            "fields": fields,
            "ocr_used": ocr_used,
        }


def convert_bytes_to_markdown(
    data: bytes,
    filename: str,
    mime_type: str = "",
    use_ocr: bool = True,
) -> Dict[str, Any]:
    """Converts raw document bytes to clean GitHub Flavored Markdown."""
    return MarkItDownConverter.convert_bytes_to_markdown(
        data, filename, mime_type=mime_type, use_ocr=use_ocr
    )


def get_markdown_storage_key(tenant_id: str, doc_id: str, filename: str) -> str:
    """Returns the canonical .md storage key for a tenant document."""
    return MarkItDownConverter.get_markdown_storage_key(tenant_id, doc_id, filename)


def ensure_document_markdown(
    c: Any,
    tenant_id: str,
    doc_row: Dict[str, Any],
    persist: bool = True,
) -> Dict[str, Any]:
    """Ensures cached GFM Markdown exists for doc_row and returns normalized document metadata."""
    return MarkItDownConverter.ensure_document_markdown(c, tenant_id, doc_row, persist=persist)
