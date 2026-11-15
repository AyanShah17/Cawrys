import io
import logging
import os
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

logger = logging.getLogger("intelligence.ingest")

IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}

_SWIFT_OCR_SOURCE = r"""
import Foundation
import AppKit
import PDFKit
import Vision

let args = CommandLine.arguments
if args.count < 3 {
    exit(1)
}
let mode = args[1]
let filePath = args[2]
let maxPages = args.count >= 4 ? (Int(args[3]) ?? 15) : 15

func recognizeCGImage(_ cgImage: CGImage) -> [String] {
    var lines: [String] = []
    let request = VNRecognizeTextRequest { req, err in
        if err != nil { return }
        guard let obs = req.results as? [VNRecognizedTextObservation] else { return }
        // Sort top-to-bottom (higher Y is top in Vision normalized coords), then left-to-right
        let sorted = obs.sorted { a, b in
            let dy = a.boundingBox.midY - b.boundingBox.midY
            if abs(dy) > 0.012 {
                return a.boundingBox.midY > b.boundingBox.midY
            }
            return a.boundingBox.minX < b.boundingBox.minX
        }
        var currentY: CGFloat? = nil
        var rowChunks: [String] = []
        for item in sorted {
            guard let candidate = item.topCandidates(1).first else { continue }
            let txt = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
            if txt.isEmpty { continue }
            let y = item.boundingBox.midY
            if let cy = currentY, abs(cy - y) <= 0.012 {
                rowChunks.append(txt)
            } else {
                if !rowChunks.isEmpty {
                    lines.append(rowChunks.joined(separator: " | "))
                }
                rowChunks = [txt]
                currentY = y
            }
        }
        if !rowChunks.isEmpty {
            lines.append(rowChunks.joined(separator: " | "))
        }
    }
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try? handler.perform([request])
    return lines
}

func renderPDFPage(_ page: PDFPage) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    guard bounds.width > 0, bounds.height > 0 else { return nil }
    let scale: CGFloat = min(2.5, max(1.5, 1800.0 / max(bounds.width, bounds.height)))
    let width = Int(bounds.width * scale)
    let height = Int(bounds.height * scale)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue
    guard let ctx = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: bitmapInfo
    ) else {
        return nil
    }
    ctx.setFillColor(NSColor.white.cgColor)
    ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
    ctx.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: ctx)
    return ctx.makeImage()
}

if mode == "pdf" {
    guard let doc = PDFDocument(url: URL(fileURLWithPath: filePath)) else {
        exit(2)
    }
    let count = min(doc.pageCount, maxPages)
    var output: [String] = []
    for i in 0..<count {
        guard let page = doc.page(at: i), let cg = renderPDFPage(page) else { continue }
        let pageLines = recognizeCGImage(cg)
        if !pageLines.isEmpty {
            output.append("--- Page \(i + 1) of \(doc.pageCount) ---")
            output.append(contentsOf: pageLines)
        }
    }
    print(output.joined(separator: "\n"))
} else {
    guard let nsImg = NSImage(contentsOfFile: filePath) else {
        exit(2)
    }
    var rect = NSRect(origin: .zero, size: nsImg.size)
    guard let cg = nsImg.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
        exit(2)
    }
    let lines = recognizeCGImage(cg)
    print(lines.joined(separator: "\n"))
}
"""

_OCR_SWIFT_PATH = Path("/tmp/cawrys_vision_ocr.swift")
_OCR_BIN_PATH = Path("/tmp/cawrys_vision_ocr_bin")


def _ensure_ocr_runner() -> list[str] | None:
    if sys.platform != "darwin" or not os.path.exists("/usr/bin/swift"):
        return None
    try:
        if not _OCR_SWIFT_PATH.exists() or _OCR_SWIFT_PATH.read_text(encoding="utf-8") != _SWIFT_OCR_SOURCE:
            _OCR_SWIFT_PATH.write_text(_SWIFT_OCR_SOURCE, encoding="utf-8")
            if _OCR_BIN_PATH.exists():
                try:
                    _OCR_BIN_PATH.unlink()
                except OSError:
                    pass
        if not _OCR_BIN_PATH.exists() and os.path.exists("/usr/bin/swiftc"):
            os.makedirs("/tmp/swift-cache", exist_ok=True)
            comp = subprocess.run(
                [
                    "/usr/bin/swiftc",
                    "-O",
                    "-module-cache-path",
                    "/tmp/swift-cache",
                    str(_OCR_SWIFT_PATH),
                    "-o",
                    str(_OCR_BIN_PATH),
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if comp.returncode == 0 and _OCR_BIN_PATH.exists():
                return [str(_OCR_BIN_PATH)]
        if _OCR_BIN_PATH.exists():
            return [str(_OCR_BIN_PATH)]
        os.makedirs("/tmp/swift-cache", exist_ok=True)
        return ["/usr/bin/swift", "-module-cache-path", "/tmp/swift-cache", str(_OCR_SWIFT_PATH)]
    except Exception as e:
        logger.debug(f"OCR runner unavailable: {e}")
        return None


def _ocr_pdf_or_image_bytes(data: bytes, mode: str, ext: str = ".bin", max_pages: int = 12) -> str:
    runner = _ensure_ocr_runner()
    if not runner or not data:
        return ""
    tmp_path = Path(tempfile.gettempdir()) / f"cawrys_ocr_{uuid.uuid4().hex}{ext}"
    try:
        tmp_path.write_bytes(data)
        proc = subprocess.run(
            [*runner, mode, str(tmp_path), str(max_pages)],
            capture_output=True,
            text=True,
            timeout=45,
        )
        if proc.returncode == 0:
            return (proc.stdout or "").strip()
        logger.debug(f"OCR runner returned {proc.returncode}: {proc.stderr[:200]}")
        return ""
    except Exception as e:
        logger.debug(f"OCR execution skipped/failed: {e}")
        return ""
    finally:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except OSError:
            pass


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
            for idx, p in enumerate(reader.pages):
                try:
                    txt = (p.extract_text() or "").strip()
                    if txt:
                        pages_text.append(f"--- Page {idx + 1} of {len(reader.pages)} ---\n{txt}")
                except Exception as page_err:
                    logger.warning(f"Failed extracting text from PDF page: {page_err}")
                    continue

            extracted = "\n".join(pages_text).strip()
            non_ws_len = len("".join(extracted.split()))
            if non_ws_len >= 40:
                return extracted

            # Scanned / image-based PDF: fall back to Vision OCR
            ocr_text = _ocr_pdf_or_image_bytes(data, mode="pdf", ext=".pdf", max_pages=12)
            if ocr_text and len("".join(ocr_text.split())) >= 15:
                return ocr_text
            if extracted:
                return extracted
            return "[PDF document contains no extractable text or is image-based]"
        except Exception as e:
            logger.warning(f"PDF extraction fallback: {e}")
            ocr_text = _ocr_pdf_or_image_bytes(data, mode="pdf", ext=".pdf", max_pages=12)
            if ocr_text:
                return ocr_text
            return f"[PDF text extraction failed: {type(e).__name__} - {e}]"

    if k == "image":
        ocr_text = _ocr_pdf_or_image_bytes(data, mode="image", ext=".png", max_pages=1)
        if ocr_text:
            return ocr_text
        return "[Image document contains no extractable text]"

    if k == "docx":
        try:
            from docx import Document

            doc = Document(io.BytesIO(data))
            return "\n".join(p.text for p in doc.paragraphs)
        except Exception as e:
            logger.warning(f"DOCX extraction fallback: {e}")
            return f"[DOCX text extraction failed: {type(e).__name__} - {e}]"

    return data.decode("utf-8", errors="replace")
