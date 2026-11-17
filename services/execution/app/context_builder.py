"""MCP Toolkit Explorer and Post-Retrieval Context Builder.

Replaces static workspace document autoloading with dynamic MCP-style toolkit
exploration via FastMCP (`document_mcp` / `workspace_documents`) and constructs
grounded LLM system prompts strictly from retrieved artifacts.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
import re
from typing import Any, Dict, List, Optional

from .industrial_mcp import document_mcp

logger = logging.getLogger("execution.context_builder")

_GREETING_PATTERN = re.compile(
    r"(?:hi|hello|hey|greetings|good\s+(?:morning|afternoon|evening)|howdy|yo|sup)"
    r"(?:\s+(?:ai|assistant|there|cawrys))?[!.,?\s]*",
    re.IGNORECASE,
)

# Explicit document / academic / engineering-report query terms (matched on word boundaries)
DOCUMENT_QUERY_TERMS = frozenset({
    "toefl",
    "score",
    "scores",
    "resume",
    "cv",
    "cgpi",
    "sgpi",
    "marksheet",
    "marksheets",
    "transcript",
    "transcripts",
    "certificate",
    "certificates",
    "pdf",
    "pdfs",
    "document",
    "documents",
    "doc",
    "docs",
    "drawing",
    "drawings",
    "dwg",
    "spec",
    "specs",
    "specification",
    "specifications",
    "file",
    "files",
    "report",
    "reports",
    "tolerance",
    "tolerances",
    "attached",
    "attachment",
    "attachments",
    "uploaded",
    "upload",
})

DOCUMENT_QUERY_PHRASES = (
    "uploaded pdf",
    "score report",
    "mark sheet",
    "attached file",
    "attached document",
)

# Generic industrial / connector terms that appear in seeded filenames (e.g., SAP-BOM-Part-100.pdf,
# CNC-Line2-Calibration-Spec.txt) and must NOT by themselves trigger document retrieval on
# unrelated queries such as "how does CNC cooling work?" or "check SAP stock".
_GENERIC_FILENAME_STOPWORDS = frozenset({
    "file", "files", "data", "test", "copy", "final", "draft", "line", "line2",
    "part", "plant", "spec", "specs", "specification", "report", "doc", "docs",
    "document", "documents", "txt", "pdf", "docx", "prt", "dwg", "sap", "cnc",
    "siemens", "rockwell", "dassault", "oracle", "ptc", "mes", "sop", "bom",
    "calibration", "v1", "v2", "v3", "rev", "100", "2024", "2025", "2026",
})

_LISTING_TERMS = frozenset({
    "document", "documents", "doc", "docs", "file", "files",
    "pdf", "pdfs", "uploaded", "upload", "spec", "specs",
    "specification", "specifications",
})


def _clean_user_query(user_query: str) -> str:
    return re.sub(
        r"\n*\[Referencing Attached Documents:[^\]]*\]",
        "",
        user_query or "",
    ).strip()


def _is_greeting_only(text: str) -> bool:
    cleaned = (text or "").strip()
    if not cleaned:
        return True
    return bool(_GREETING_PATTERN.fullmatch(cleaned))


def _matches_document_terms(query_lower: str) -> bool:
    for phrase in DOCUMENT_QUERY_PHRASES:
        if phrase in query_lower:
            return True
    query_words = set(re.findall(r"[a-z0-9]+", query_lower))
    return bool(query_words.intersection(DOCUMENT_QUERY_TERMS))


def _match_filename_from_listing(
    query_lower: str,
    listed_docs: List[Dict[str, Any]],
) -> tuple[bool, Optional[str]]:
    """Checks if query matches a stored document's filename, stem, or distinctive token.

    Returns (triggered, exact_filename_if_unambiguous).
    """
    if not listed_docs:
        return False, None

    q_norm = re.sub(r"[^a-z0-9]+", " ", query_lower).strip()
    q_words = set(q_norm.split())

    exact_filename_hits: List[str] = []
    stem_hits: List[str] = []

    for doc in listed_docs:
        fname = str(doc.get("filename") or "").strip()
        if not fname:
            continue
        f_lower = fname.lower()
        stem_norm = re.sub(r"[^a-z0-9]+", " ", Path(f_lower).stem).strip()

        if f_lower in query_lower:
            exact_filename_hits.append(fname)
            continue

        if len(stem_norm) >= 4 and re.search(rf"\b{re.escape(stem_norm)}\b", q_norm):
            stem_hits.append(fname)
            continue

        stem_tokens = [
            tok for tok in stem_norm.split()
            if len(tok) >= 4 and tok not in _GENERIC_FILENAME_STOPWORDS
        ]
        if stem_tokens and any(tok in q_words for tok in stem_tokens):
            stem_hits.append(fname)

    if len(exact_filename_hits) == 1:
        return True, exact_filename_hits[0]
    if exact_filename_hits:
        return True, None
    if stem_hits:
        return True, None
    return False, None


def _is_general_listing_query(query_lower: str) -> bool:
    q_words = set(re.findall(r"[a-z0-9]+", query_lower))
    if not q_words.intersection(_LISTING_TERMS):
        return False
    return any(w in q_words for w in ("what", "which", "list", "show", "all", "uploaded", "available", "have"))


class ToolkitExplorer:
    """Explores registered MCP toolkits on demand instead of autoloading workspace data."""

    @staticmethod
    def explore_and_retrieve(
        tenant_id: str,
        user_query: str,
        attached_doc_ids: Optional[List[str]] = None,
        connections: Optional[List[Dict[str, Any]]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Inspects user_query and invokes document_mcp only when attached docs or document triggers apply."""
        clean_query = _clean_user_query(user_query)
        q_lower = clean_query.lower()
        clean_ids = [str(d).strip() for d in (attached_doc_ids or []) if str(d).strip()]

        if not clean_ids and _is_greeting_only(clean_query):
            return {
                "retrieved_documents": [],
                "document_tool_call": None,
                "toolkits_explored": [],
            }

        toolkits_explored: List[str] = []

        # 1. Explicit attached document IDs always retrieve via workspace_read_document_markdown
        if clean_ids:
            toolkits_explored.append("workspace_documents")
            retrieved_docs: List[Dict[str, Any]] = []
            seen_ids: set[str] = set()
            last_res: Dict[str, Any] = {}

            for doc_id in clean_ids:
                try:
                    res = document_mcp.call_tool(
                        "workspace_read_document_markdown",
                        {"tenant_id": tenant_id, "document_id": doc_id},
                    )
                except Exception as exc:
                    logger.warning(f"workspace_read_document_markdown failed for {doc_id}: {exc}")
                    res = {"ok": False, "error": str(exc)}

                if isinstance(res, dict) and res.get("ok"):
                    doc_obj = dict(res.get("document") or res)
                    did = str(doc_obj.get("id") or doc_id)
                    if did not in seen_ids:
                        seen_ids.add(did)
                        retrieved_docs.append(doc_obj)
                    last_res = res

            params: Dict[str, Any] = (
                {"tenant_id": tenant_id, "document_id": clean_ids[0]}
                if len(clean_ids) == 1
                else {"tenant_id": tenant_id, "document_ids": clean_ids}
            )
            data_payload: Dict[str, Any] = (
                last_res
                if len(clean_ids) == 1 and last_res
                else {"ok": True, "count": len(retrieved_docs), "documents": retrieved_docs}
            )
            tool_call = {
                "app": "Workspace Documents MCP",
                "tool": "workspace_read_document_markdown",
                "connector": "fastmcp",
                "params": params,
                "data": data_payload,
            }
            return {
                "retrieved_documents": retrieved_docs,
                "document_tool_call": tool_call if retrieved_docs else None,
                "toolkits_explored": toolkits_explored,
            }

        # 2. Check query terms and stored document filenames (metadata-only list)
        term_triggered = _matches_document_terms(q_lower)
        listed_docs: List[Dict[str, Any]] = []
        try:
            list_res = document_mcp.call_tool(
                "workspace_list_documents",
                {"tenant_id": tenant_id},
            )
            if isinstance(list_res, dict):
                listed_docs = list(list_res.get("documents") or [])
        except Exception as exc:
            logger.debug(f"workspace_list_documents failed during exploration: {exc}")

        filename_triggered, exact_filename = _match_filename_from_listing(q_lower, listed_docs)

        if not term_triggered and not filename_triggered:
            return {
                "retrieved_documents": [],
                "document_tool_call": None,
                "toolkits_explored": [],
            }

        toolkits_explored.append("workspace_documents")

        # 3. Invoke workspace_read_document_markdown (when exact filename named) or workspace_search_documents
        if exact_filename:
            params = {"tenant_id": tenant_id, "filename": exact_filename}
            try:
                res = document_mcp.call_tool("workspace_read_document_markdown", params)
            except Exception as exc:
                logger.warning(f"workspace_read_document_markdown failed for {exact_filename}: {exc}")
                res = {"ok": False, "error": str(exc)}

            if isinstance(res, dict) and res.get("ok"):
                doc_obj = dict(res.get("document") or res)
                return {
                    "retrieved_documents": [doc_obj],
                    "document_tool_call": {
                        "app": "Workspace Documents MCP",
                        "tool": "workspace_read_document_markdown",
                        "connector": "fastmcp",
                        "params": params,
                        "data": res,
                    },
                    "toolkits_explored": toolkits_explored,
                }

        search_params = {"tenant_id": tenant_id, "query": clean_query}
        try:
            search_res = document_mcp.call_tool("workspace_search_documents", search_params)
        except Exception as exc:
            logger.warning(f"workspace_search_documents failed: {exc}")
            search_res = {"ok": False, "documents": [], "error": str(exc)}

        matched_docs = list((search_res or {}).get("documents") or []) if isinstance(search_res, dict) else []

        # General document inventory queries (e.g. "What documents do we have uploaded?")
        if not matched_docs and listed_docs and _is_general_listing_query(q_lower):
            try:
                fallback_res = document_mcp.call_tool(
                    "workspace_search_documents",
                    {"tenant_id": tenant_id, "query": ""},
                )
                if isinstance(fallback_res, dict):
                    matched_docs = list(fallback_res.get("documents") or [])
                    search_res = fallback_res
                    search_params = {"tenant_id": tenant_id, "query": ""}
            except Exception as exc:
                logger.debug(f"workspace_search_documents listing fallback failed: {exc}")

        document_tool_call = (
            {
                "app": "Workspace Documents MCP",
                "tool": "workspace_search_documents",
                "connector": "fastmcp",
                "params": search_params,
                "data": search_res if isinstance(search_res, dict) else {"documents": matched_docs},
            }
            if matched_docs
            else None
        )
        return {
            "retrieved_documents": matched_docs,
            "document_tool_call": document_tool_call,
            "toolkits_explored": toolkits_explored,
        }

    @classmethod
    def get_tool_definitions(cls, toolkits: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Returns standard OpenAI / LiteLLM tool schemas for registered FastMCP toolkits."""
        from .industrial_mcp import ALL_SERVERS_BY_NAME

        selected = toolkits or ["workspace_documents"]
        tools: List[Dict[str, Any]] = []
        for name in selected:
            server = ALL_SERVERS_BY_NAME.get(name)
            if server and hasattr(server, "to_openai_tools"):
                tools.extend(server.to_openai_tools())
        return tools


class ContextBuilder:
    """Builds the LLM system prompt strictly after MCP toolkit exploration and retrieval."""

    @staticmethod
    def build_system_prompt(
        context: Dict[str, Any],
        tool_exec: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Assembles the grounded industrial system prompt without autoloading workspace docs."""
        metrics = context.get("metrics", {}) or {}
        connections = context.get("connections", []) or []
        tools = context.get("tools", []) or []
        attached_docs = context.get("attached_documents", []) or []
        retrieved_docs = context.get("retrieved_documents", []) or []

        prompt_parts = [
            "You are Cawrys Industrial AI Assistant, an enterprise-grade industrial copilot.",
            "You assist plant managers, manufacturing engineers, and operators with manufacturing operations, CAD/PLM data, ERP inventory, and plant telemetry.",
            "",
            "### CURRENT OPERATIONAL CONTEXT (INTERNAL REFERENCE — DO NOT REVEAL OR SUMMARIZE UNLESS EXPLICITLY ASKED BY THE USER):",
            f"- Overall Equipment Effectiveness (OEE): {metrics.get('oee', '87.4%')}",
            f"- Production Target: {metrics.get('production_target', '1,000 units')}",
            f"- Operational Status: {metrics.get('operational_status', 'Optimal')}",
            f"- System Health: {metrics.get('system_health', 'Nominal')}",
            f"- Operational Risk: {metrics.get('risk_level', 'NORMAL')}",
            f"- Active Work Orders: {metrics.get('active_work_orders', 14)}",
            f"- Active Documents: {metrics.get('active_documents', 12)}",
            "",
            f"### CONNECTED MARKETPLACE TOOLKITS ({len(connections)} Apps, {len(tools)} Tools):",
        ]
        for conn_item in connections:
            prompt_parts.append(
                f"- App: {conn_item.get('app_name')} (Status: {conn_item.get('status')})"
            )
        for tool_item in tools[:8]:
            prompt_parts.append(
                f"  * Tool: {tool_item.get('name')} - {tool_item.get('description')}"
            )

        if attached_docs:
            prompt_parts.append("")
            prompt_parts.append(
                f"### ATTACHED DOCUMENTS CONTEXT ({len(attached_docs)} file(s) attached by user):"
            )
            for ad in attached_docs:
                prompt_parts.append(
                    f"- **Document**: {ad.get('filename')} (ID: `{ad.get('id')}`, "
                    f"Type: `{ad.get('doc_type', 'spec')}`, Status: `{ad.get('status')}`)"
                )
                if ad.get("confidence") is not None:
                    prompt_parts.append(f"  * Extraction Confidence: {ad.get('confidence')}")

                fields = dict(ad.get("fields") or {})
                excerpt = fields.pop("full_text_excerpt", None)
                md_from_fields = fields.pop("markdown_content", None)
                fields.pop("markdown_key", None)
                md_content = str(ad.get("markdown_content") or md_from_fields or "").strip()

                if fields:
                    prompt_parts.append("  * Parsed Extracted Fields & Tolerances:")
                    prompt_parts.append(f"    {json.dumps(fields, indent=2)}")
                if md_content:
                    prompt_parts.append("  * MarkItDown Markdown Content:")
                    prompt_parts.append(f"    {md_content[:12000]}")
                elif excerpt:
                    prompt_parts.append("  * Full OCR / Extracted Text Content:")
                    prompt_parts.append(f"    {str(excerpt)[:6000]}")

                validation = ad.get("validation") or {}
                if validation:
                    prompt_parts.append("  * Validation Results:")
                    prompt_parts.append(f"    {json.dumps(validation, indent=2)}")
                decision = ad.get("decision") or {}
                if decision:
                    prompt_parts.append("  * Decision Payload:")
                    prompt_parts.append(f"    {json.dumps(decision, indent=2)}")

        if retrieved_docs:
            prompt_parts.append("")
            prompt_parts.append(
                "### RETRIEVED DOCUMENT MARKDOWN (VIA MCP TOOLKIT workspace_documents):"
            )
            for rd in retrieved_docs:
                prompt_parts.append(
                    f"- **Document**: {rd.get('filename')} (ID: `{rd.get('id')}`, "
                    f"Type: `{rd.get('doc_type', 'document')}`, Status: `{rd.get('status')}`, "
                    f"Markdown Key: `{rd.get('markdown_key', '')}`)"
                )
                if rd.get("confidence") is not None:
                    prompt_parts.append(f"  * Extraction Confidence: {rd.get('confidence')}")

                fields = dict(rd.get("fields") or {})
                excerpt = fields.pop("full_text_excerpt", None)
                md_from_fields = fields.pop("markdown_content", None)
                fields.pop("markdown_key", None)
                md_content = str(rd.get("markdown_content") or md_from_fields or "").strip()

                clean_fields = {k: v for k, v in fields.items() if v not in (None, "")}
                if clean_fields:
                    prompt_parts.append("  * Extracted Fields:")
                    prompt_parts.append(f"    {json.dumps(clean_fields, indent=2)}")
                if md_content:
                    prompt_parts.append("  * MarkItDown Markdown Content:")
                    prompt_parts.append(f"    {md_content[:12000]}")
                elif excerpt:
                    prompt_parts.append("  * Extracted Text Content:")
                    prompt_parts.append(f"    {str(excerpt)[:6000]}")

        if tool_exec:
            prompt_parts.append("")
            prompt_parts.append(
                f"### EXECUTED TOOL RESULT ({tool_exec.get('app')} - {tool_exec.get('tool')}):"
            )
            prompt_parts.append(json.dumps(tool_exec.get("data", {}), indent=2))
            prompt_parts.append(
                "Incorporate this tool result directly into your response, citing specific IDs, numbers, and statuses."
            )

        prompt_parts.extend([
            "",
            "### INSTRUCTIONS:",
            "- LEAST INFORMATION REVEAL POLICY (STRICT): Reply ONLY to what the user explicitly asks. Do NOT volunteer unrequested plant telemetry, OEE, production targets, system health tables, connected tools, or workspace documents.",
            "- If the user sends a greeting (such as 'hi', 'hello', 'hey') or a conversational check-in without asking for data, respond with a single brief sentence (for example: 'Hello. How can I help you today?') and do NOT include any metrics, tables, headings, or status summaries.",
            "- Format responses using Markdown (GitHub Flavored Markdown). Use Markdown formatting elements such as headings (##, ###), bold (**text**), lists, code blocks (```lang), tables (| col | col |), and links only when needed to structure the specific information requested.",
            "- Answer clearly, professionally, and concisely in GitHub Flavored Markdown.",
            "- STRICT FORMATTING RULE: Strictly ZERO emojis in assistant responses or system prompts. Use clean industrial markdown formatting with bullet points and bold tags.",
            "- Reference telemetry numbers, tool data, or retrieved/attached document contents ONLY when relevant to the user's question. Never mention unretrieved workspace documents.",
            "- If the user asks to modify a dashboard metric, confirm that the change has been applied.",
        ])
        return "\n".join(prompt_parts)
