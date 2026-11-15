"""Playbook CRUD, tool auto-registration, and AI-assisted pipeline editing."""
import json
import os
import re
from typing import Any, Optional


def _log_audit(c, tenant_id: str, event: str, workflow_id: Optional[str] = None, detail: Optional[dict] = None, actor: str = "system"):
    c.execute(
        "insert into audit_log (tenant_id, actor, service, event, workflow_id, detail) values (%s,%s,'execution',%s,%s,%s)",
        (tenant_id, actor, event, workflow_id, json.dumps(detail or {})),
    )


def ensure_tool_registered(
    c,
    tenant_id: str,
    tool_name: str,
    risk: str = "low",
    connector: str = "log",
    description: Optional[str] = None,
) -> None:
    """Ensures a tool exists in the tenant's tools registry so pipeline steps execute cleanly."""
    clean_name = re.sub(r"[^a-zA-Z0-9_:-]+", "_", tool_name.strip()).strip("_")
    if not clean_name:
        return
    existing = c.execute(
        "select 1 from tools where tenant_id=%s and name=%s",
        (tenant_id, clean_name),
    ).fetchone()
    if existing:
        return
    schema = {"type": "object", "additionalProperties": True, "properties": {}}
    desc = description or f"Pipeline step tool: {clean_name}"
    c.execute(
        "insert into tools (tenant_id,name,description,input_schema,connector,risk) values (%s,%s,%s,%s,%s,%s)",
        (tenant_id, clean_name, desc, json.dumps(schema), connector, risk if risk in ("low", "medium", "high") else "low"),
    )


def list_latest_playbooks(c, tenant_id: str) -> list[dict[str, Any]]:
    rows = c.execute(
        "select name, version, steps from playbooks where tenant_id=%s order by name asc, version desc",
        (tenant_id,),
    ).fetchall()
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for r in rows:
        name = r["name"]
        if name in seen:
            continue
        seen.add(name)
        steps = r["steps"]
        if isinstance(steps, str):
            try:
                steps = json.loads(steps)
            except Exception:
                steps = []
        out.append({"name": name, "version": int(r["version"]), "steps": steps or []})
    return out


def get_latest_playbook(c, tenant_id: str, name: str) -> Optional[dict[str, Any]]:
    row = c.execute(
        "select id, name, version, steps from playbooks where tenant_id=%s and name=%s order by version desc limit 1",
        (tenant_id, name),
    ).fetchone()
    if not row:
        return None
    steps = row["steps"]
    if isinstance(steps, str):
        try:
            steps = json.loads(steps)
        except Exception:
            steps = []
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "version": int(row["version"]),
        "steps": steps or [],
    }


def _default_params_for_tool(tool_name: str, playbook_name: str = "") -> dict[str, Any]:
    t = tool_name.lower()
    if t == "erp_lookup_inventory" or ("erp" in t and "inventory" in t):
        return {"material": "$inputs.material"}
    if t == "schedule_production":
        return {"drawing_id": "$inputs.drawing_id", "quantity": "$inputs.quantity"}
    if t == "notify_team" or "slack" in t:
        return {"message": f"Pipeline update for {playbook_name or '$inputs.drawing_id'}"}
    if "quality" in t or "inspect" in t or "cmm" in t:
        return {"drawing_id": "$inputs.drawing_id", "standard": "ISO 2768-mK"}
    return {}


def _normalize_steps(steps: list[Any], playbook_name: str = "") -> list[dict[str, Any]]:
    norm: list[dict[str, Any]] = []
    for item in steps or []:
        if isinstance(item, str) and item.strip():
            tool = item.strip()
            norm.append({"tool": tool, "params": _default_params_for_tool(tool, playbook_name)})
        elif isinstance(item, dict) and str(item.get("tool", "")).strip():
            tool = str(item["tool"]).strip()
            params = item.get("params")
            if not isinstance(params, dict) or not params:
                params = _default_params_for_tool(tool, playbook_name)
            norm.append({"tool": tool, "params": params})
    return norm


def save_playbook_version(
    c,
    tenant_id: str,
    name: str,
    steps: list[dict[str, Any]],
    actor: str = "system",
    event: str = "playbook.saved",
) -> dict[str, Any]:
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Playbook name cannot be empty")
    clean_steps = _normalize_steps(steps, clean_name)
    for st in clean_steps:
        ensure_tool_registered(c, tenant_id, st["tool"])
    row = c.execute(
        "select coalesce(max(version),0)+1 as v from playbooks where tenant_id=%s and name=%s",
        (tenant_id, clean_name),
    ).fetchone()
    next_v = int(row["v"]) if row else 1
    c.execute(
        "insert into playbooks (tenant_id,name,version,steps) values (%s,%s,%s,%s)",
        (tenant_id, clean_name, next_v, json.dumps(clean_steps)),
    )
    _log_audit(c, tenant_id, event, detail={"name": clean_name, "version": next_v, "step_count": len(clean_steps)}, actor=actor)
    c.commit()
    return {"name": clean_name, "version": next_v, "steps": clean_steps}


def delete_playbook(c, tenant_id: str, name: str, actor: str = "system") -> bool:
    rows = c.execute(
        "select id from playbooks where tenant_id=%s and name=%s",
        (tenant_id, name),
    ).fetchall()
    if not rows:
        return False
    pb_ids = [str(r["id"]) for r in rows]
    placeholders = ", ".join(["%s"] * len(pb_ids))
    c.execute(
        f"update executions set playbook_id=NULL where playbook_id in ({placeholders})",
        tuple(pb_ids),
    )
    c.execute("delete from playbooks where tenant_id=%s and name=%s", (tenant_id, name))
    _log_audit(c, tenant_id, "playbook.deleted", detail={"name": name, "versions_removed": len(pb_ids)}, actor=actor)
    c.commit()
    return True


def _infer_tool_from_phrase(phrase: str, available_tools: list[str]) -> str:
    low = phrase.lower().strip()
    # Direct match with available tool names
    for t in sorted(available_tools, key=len, reverse=True):
        if t.lower() in low:
            return t

    # Explicit snake_case identifier inside phrase (e.g. "quality_check", "send_slack_alert", "cmm_inspect")
    m_ident = re.search(r"\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b", low)
    if m_ident:
        return m_ident.group(1)

    # Common industrial aliases
    if any(k in low for k in ("slack", "alert", "notify")):
        if "slack" in low:
            return "slack_notify"
        return "notify_team"
    if any(k in low for k in ("quality", "inspect", "qc")):
        return "quality_check"
    if "cmm" in low:
        return "fastmcp_cmm_inspection"
    if any(k in low for k in ("safety", "ehs", "lockout")):
        return "safety_verification"
    if any(k in low for k in ("erp", "inventory", "sap", "stock")):
        return "erp_lookup_inventory"
    if any(k in low for k in ("schedule", "production", "mes")):
        return "schedule_production"
    if any(k in low for k in ("email", "mail", "report")):
        return "send_report"
    if any(k in low for k in ("approve", "approval", "signoff", "sign-off")):
        return "approval_gate"

    # Extract snake/kebab identifier from cleaned phrase
    cleaned = re.sub(
        r"\b(add|insert|append|prepend|create|new|a|an|the|step|node|tool|named|called|to|into|in|at|end|start|beginning|before|after|position|playbook|pipeline|with|param|params)\b",
        " ",
        low,
    )
    tokens = [tok for tok in re.findall(r"[a-z0-9_:-]+", cleaned) if tok]
    if tokens:
        candidate = "_".join(tokens[:4]).replace("-", "_")
        if len(candidate) >= 2:
            return candidate
    return "custom_pipeline_step"


def _find_step_index(steps: list[dict[str, Any]], token: str) -> Optional[int]:
    if not token or not steps:
        return None
    low = token.lower().strip()
    m_num = re.search(r"step\s*#?\s*(\d+)", low)
    if m_num:
        idx = int(m_num.group(1)) - 1
        if 0 <= idx < len(steps):
            return idx
    if low in ("last", "last step", "final", "final step"):
        return len(steps) - 1
    if low in ("first", "first step"):
        return 0
    for idx, st in enumerate(steps):
        if st["tool"].lower() == low:
            return idx
    for idx, st in enumerate(steps):
        norm_tool = st["tool"].lower().replace("_", " ")
        if low in st["tool"].lower() or low in norm_tool or st["tool"].lower() in low:
            return idx
    return None


def _coerce_param_val(raw: str) -> Any:
    s = raw.strip().strip("\"'`")
    if s.lower() == "true":
        return True
    if s.lower() == "false":
        return False
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    if re.fullmatch(r"-?\d+\.\d+", s):
        return float(s)
    return s


def _deterministic_playbook_edit(
    prompt: str,
    playbooks: list[dict[str, Any]],
    target_pb: Optional[dict[str, Any]],
    available_tools: list[str],
) -> Optional[dict[str, Any]]:
    text = prompt.strip()
    low = text.lower()

    # Check if prompt names a different existing playbook explicitly
    chosen_pb = target_pb
    for pb in playbooks:
        pb_name = pb["name"]
        if re.search(rf"\b{re.escape(pb_name.lower())}\b", low):
            chosen_pb = pb
            break
    if chosen_pb is None and playbooks:
        chosen_pb = playbooks[0]

    # 1. Create a new playbook
    m_create = re.search(
        r"(?:create|make|build|new)\s+(?:a\s+)?playbook\s+(?:called\s+|named\s+)?([a-zA-Z0-9_-]+)(?:\s+with\s+(.+))?",
        text,
        re.IGNORECASE,
    )
    if m_create:
        new_name = m_create.group(1).strip()
        raw_tools = m_create.group(2) or ""
        parts = [p.strip() for p in re.split(r"[,;\n]|\band\b|\bthen\b|->", raw_tools) if p.strip()]
        steps = []
        for p in parts:
            tname = _infer_tool_from_phrase(p, available_tools)
            steps.append({"tool": tname, "params": {}})
        if not steps:
            steps = [
                {"tool": "erp_lookup_inventory", "params": {"material": "$inputs.material"}},
                {"tool": "notify_team", "params": {"message": f"Completed {new_name}"}},
            ]
        return {
            "action": "playbook_created",
            "playbook_name": new_name,
            "steps": steps,
            "message": f"Created playbook '{new_name}' with {len(steps)} step(s): {', '.join(s['tool'] for s in steps)}.",
        }

    # 2. Delete an entire playbook
    m_del_pb = re.search(
        r"(?:delete|remove|drop)\s+(?:the\s+)?playbook\s+(?:called\s+|named\s+)?([a-zA-Z0-9_-]+)",
        text,
        re.IGNORECASE,
    )
    if m_del_pb and "step" not in low.split(m_del_pb.group(1).lower())[0]:
        del_name = m_del_pb.group(1).strip()
        return {
            "action": "playbook_deleted",
            "playbook_name": del_name,
            "steps": [],
            "message": f"Deleted playbook '{del_name}'.",
        }

    if chosen_pb is None:
        return None

    steps = [dict(s, params=dict(s.get("params") or {})) for s in chosen_pb["steps"]]
    pb_name = chosen_pb["name"]

    # 3. Delete / remove a step
    if re.search(r"\b(delete|remove|drop)\b", low):
        rm_idx: Optional[int] = None
        if re.search(r"\b(last|final)\s+step\b", low) and steps:
            rm_idx = len(steps) - 1
        elif re.search(r"\bfirst\s+step\b", low) and steps:
            rm_idx = 0
        else:
            m_step_num = re.search(r"\bstep\s*#?\s*(\d+)\b", low)
            if m_step_num:
                idx = int(m_step_num.group(1)) - 1
                if 0 <= idx < len(steps):
                    rm_idx = idx
            if rm_idx is None:
                for idx, st in enumerate(steps):
                    t = st["tool"].lower()
                    if t in low or t.replace("_", " ") in low:
                        rm_idx = idx
                        break
        if rm_idx is not None and 0 <= rm_idx < len(steps):
            removed = steps.pop(rm_idx)
            return {
                "action": "step_deleted",
                "playbook_name": pb_name,
                "steps": steps,
                "message": f"Removed step {rm_idx + 1} ('{removed['tool']}') from playbook '{pb_name}'.",
            }

    # 4. Move / reorder step
    m_move = re.search(
        r"\b(?:move|reorder)\s+([a-zA-Z0-9_ -]+?)\s+(?:to\s+(?:step\s+|position\s+)?(\d+)|to\s+(start|beginning|first|end|last)|(before|after)\s+([a-zA-Z0-9_ -]+))",
        low,
    )
    if m_move and len(steps) >= 2:
        src_tok = m_move.group(1).strip()
        src_idx = _find_step_index(steps, src_tok)
        if src_idx is not None:
            item = steps.pop(src_idx)
            if m_move.group(2):
                dest = max(0, min(len(steps), int(m_move.group(2)) - 1))
                steps.insert(dest, item)
            elif m_move.group(3):
                pos_word = m_move.group(3)
                if pos_word in ("start", "beginning", "first"):
                    steps.insert(0, item)
                else:
                    steps.append(item)
            elif m_move.group(4) and m_move.group(5):
                rel = m_move.group(4)
                ref_idx = _find_step_index(steps, m_move.group(5).strip())
                if ref_idx is None:
                    steps.append(item)
                else:
                    steps.insert(ref_idx if rel == "before" else ref_idx + 1, item)
            return {
                "action": "steps_reordered",
                "playbook_name": pb_name,
                "steps": steps,
                "message": f"Reordered '{item['tool']}' inside playbook '{pb_name}'.",
            }

    # 5. Update / replace / edit step tool or parameter
    # 5a. Replace step tool: "replace|change step 2 with/to new_tool" or "rename notify_team to slack_notify"
    m_repl = re.search(
        r"\b(?:replace|rename|swap|change)\s+(step\s+\d+|[a-zA-Z0-9_-]+)\s+(?:tool\s+)?(?:to|with)\s+([a-zA-Z0-9_-]+)",
        text,
        re.IGNORECASE,
    )
    if m_repl:
        target_tok = m_repl.group(1).strip()
        new_tool = m_repl.group(2).strip().replace("-", "_")
        idx = _find_step_index(steps, target_tok)
        if idx is not None:
            old_tool = steps[idx]["tool"]
            steps[idx]["tool"] = new_tool
            return {
                "action": "step_updated",
                "playbook_name": pb_name,
                "steps": steps,
                "message": f"Updated step {idx + 1} tool from '{old_tool}' to '{new_tool}' in '{pb_name}'.",
            }

    # 5b. Set parameter on a step: "set schedule_production qty/quantity to 250" or "update material param to Titanium"
    m_param = re.search(
        r"\b(?:set|update|edit|change)\s+(?:(?:step\s+(\d+)|([a-zA-Z0-9_]+))\s+)?(?:param(?:eter)?\s+)?([a-zA-Z][a-zA-Z0-9_ ]*?)\s*(?:to|=|:)\s*([^\n;]+)",
        text,
        re.IGNORECASE,
    )
    if m_param and not re.search(r"\b(?:add|insert|append|prepend|create)\b", low):
        step_num = m_param.group(1)
        step_hint = m_param.group(2)
        raw_key = m_param.group(3).strip().lower()
        raw_val = m_param.group(4).strip()

        key_aliases = {"qty": "quantity", "mat": "material", "msg": "message", "dwg": "drawing_id"}
        param_key = key_aliases.get(raw_key, re.sub(r"[^a-z0-9]+", "_", raw_key).strip("_"))
        coerced_val = _coerce_param_val(raw_val)

        target_idx: Optional[int] = None
        if step_num:
            n = int(step_num) - 1
            if 0 <= n < len(steps):
                target_idx = n
        elif step_hint:
            target_idx = _find_step_index(steps, step_hint)
        if target_idx is None:
            # Find step already having param_key, or step whose schema/defaults fit
            for i, st in enumerate(steps):
                if param_key in (st.get("params") or {}):
                    target_idx = i
                    break
        if target_idx is None and steps:
            if param_key in ("quantity", "drawing_id"):
                target_idx = _find_step_index(steps, "schedule_production") or 0
            elif param_key == "material":
                target_idx = _find_step_index(steps, "erp_lookup_inventory") or 0
            elif param_key == "message":
                target_idx = _find_step_index(steps, "notify_team") or (len(steps) - 1)
            else:
                target_idx = 0

        if target_idx is not None and 0 <= target_idx < len(steps):
            params = dict(steps[target_idx].get("params") or {})
            params[param_key] = coerced_val
            steps[target_idx]["params"] = params
            return {
                "action": "step_updated",
                "playbook_name": pb_name,
                "steps": steps,
                "message": f"Updated {steps[target_idx]['tool']}.params.{param_key} = {json.dumps(coerced_val)} in '{pb_name}'.",
            }

    # 6. Add / insert a step
    if re.search(r"\b(add|insert|append|prepend|include|attach)\b", low):
        # Extract any explicit key=val params if supplied
        step_params: dict[str, Any] = {}
        for km, vm in re.findall(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s,;]+)", text):
            step_params[km.lower()] = _coerce_param_val(vm)

        # Determine insertion index
        insert_idx = len(steps)
        phrase_for_tool = text

        m_before = re.search(r"\bbefore\s+(step\s*\d+|[a-zA-Z0-9_-]+)", low)
        m_after = re.search(r"\bafter\s+(step\s*\d+|[a-zA-Z0-9_-]+)", low)
        m_at_pos = re.search(r"\bat\s+(?:step|position)\s*(\d+)\b|\bas\s+step\s*(\d+)\b", low)

        if m_before:
            ref_tok = m_before.group(1).strip()
            ref_idx = _find_step_index(steps, ref_tok)
            if ref_idx is not None:
                insert_idx = ref_idx
            phrase_for_tool = text[: m_before.start()]
        elif m_after:
            ref_tok = m_after.group(1).strip()
            ref_idx = _find_step_index(steps, ref_tok)
            if ref_idx is not None:
                insert_idx = ref_idx + 1
            phrase_for_tool = text[: m_after.start()]
        elif m_at_pos:
            pos = int(m_at_pos.group(1) or m_at_pos.group(2))
            insert_idx = max(0, min(len(steps), pos - 1))
            phrase_for_tool = text[: m_at_pos.start()]
        elif re.search(r"\b(at\s+(?:the\s+)?(?:start|beginning|front)|first|prepend)\b", low):
            insert_idx = 0

        # Strip "with param..." suffix and "in playbook ..." suffix from tool phrase
        phrase_for_tool = re.sub(r"\bwith\s+.*$", "", phrase_for_tool, flags=re.IGNORECASE)
        phrase_for_tool = re.sub(r"\b(?:in|to|on)\s+playbook\s+[a-zA-Z0-9_-]+", "", phrase_for_tool, flags=re.IGNORECASE)

        tool_name = _infer_tool_from_phrase(phrase_for_tool, available_tools)
        if not step_params:
            if "erp" in tool_name or "inventory" in tool_name:
                step_params = {"material": "$inputs.material"}
            elif "schedule" in tool_name or "production" in tool_name:
                step_params = {"drawing_id": "$inputs.drawing_id", "quantity": "$inputs.quantity"}
            elif "notify" in tool_name or "slack" in tool_name:
                step_params = {"message": "Pipeline checkpoint notification for $inputs.drawing_id"}
            elif "quality" in tool_name or "inspect" in tool_name or "cmm" in tool_name:
                step_params = {"drawing_id": "$inputs.drawing_id", "standard": "ISO 2768-mK"}

        steps.insert(insert_idx, {"tool": tool_name, "params": step_params})
        return {
            "action": "step_added",
            "playbook_name": pb_name,
            "steps": steps,
            "message": f"Added step '{tool_name}' at position {insert_idx + 1} in playbook '{pb_name}'.",
        }

    return None


def _llm_playbook_edit(
    prompt: str,
    playbooks: list[dict[str, Any]],
    target_pb: Optional[dict[str, Any]],
    available_tools: list[str],
    provider: str,
    model: str,
    api_key: str,
    base_url: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    if not api_key or os.environ.get("MOCK_AI", "").strip().lower() in ("1", "true", "yes"):
        return None
    try:
        from .chat_routes import _execute_litellm_completion

        system_prompt = (
            "You are an industrial automation playbook architect. Given existing playbooks and registered tools, "
            "apply the user's requested edit and respond with STRICT JSON ONLY (no markdown fences):\n"
            "{\n"
            '  "action": "step_added | step_updated | step_deleted | steps_reordered | playbook_created | playbook_deleted",\n'
            '  "playbook_name": "string",\n'
            '  "steps": [{"tool": "snake_case_tool_name", "params": {"key": "value"}}],\n'
            '  "message": "concise human confirmation sentence"\n'
            "}\n"
            f"Registered tools: {json.dumps(available_tools)}\n"
            f"Target playbook: {json.dumps(target_pb or {})}\n"
            f"All playbooks: {json.dumps(playbooks)}"
        )
        raw, err = _execute_litellm_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            provider=provider,
            model=model,
            api_key=api_key,
            base_url=base_url,
        )
        if not raw:
            return None
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.DOTALL).strip()
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict) and parsed.get("playbook_name") and parsed.get("action"):
            return parsed
    except Exception:
        return None
    return None


def apply_ai_playbook_instruction(
    c,
    tenant_id: str,
    prompt: str,
    playbook_name: Optional[str] = None,
    actor: str = "system",
    provider: Optional[str] = None,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
) -> dict[str, Any]:
    """Interprets a natural-language instruction and mutates playbooks in SQLite/PostgreSQL."""
    playbooks = list_latest_playbooks(c, tenant_id)
    tools_rows = c.execute("select name from tools where tenant_id=%s order by name", (tenant_id,)).fetchall()
    available_tools = [r["name"] for r in tools_rows]

    target_pb = None
    if playbook_name:
        for pb in playbooks:
            if pb["name"] == playbook_name:
                target_pb = pb
                break
    if target_pb is None and playbooks:
        target_pb = playbooks[0]

    # Prefer deterministic fast path first for crisp structural edits, then LLM for complex phrasing
    plan = _deterministic_playbook_edit(prompt, playbooks, target_pb, available_tools)
    if plan is None and api_key:
        plan = _llm_playbook_edit(
            prompt=prompt,
            playbooks=playbooks,
            target_pb=target_pb,
            available_tools=available_tools,
            provider=provider or "gemini",
            model=model or "gemini/gemini-2.5-flash",
            api_key=api_key,
            base_url=base_url,
        )

    if plan is None:
        raise ValueError(
            "Could not interpret playbook edit instruction. Try e.g. "
            "'Add quality_check step before schedule_production', "
            "'Set schedule_production quantity to 250', 'Remove last step', or 'Create playbook inspection with quality_check, notify_team'."
        )

    action = plan["action"]
    chosen_name = str(plan["playbook_name"]).strip()

    if action == "playbook_deleted":
        deleted = delete_playbook(c, tenant_id, chosen_name, actor=actor)
        if not deleted:
            raise ValueError(f"Playbook '{chosen_name}' not found")
        updated_all = list_latest_playbooks(c, tenant_id)
        return {
            "ok": True,
            "action": action,
            "message": plan.get("message") or f"Deleted playbook '{chosen_name}'.",
            "playbook": updated_all[0] if updated_all else None,
            "playbooks": updated_all,
        }

    saved = save_playbook_version(
        c,
        tenant_id=tenant_id,
        name=chosen_name,
        steps=plan.get("steps") or [],
        actor=actor,
        event=f"playbook.ai.{action}",
    )
    updated_all = list_latest_playbooks(c, tenant_id)
    return {
        "ok": True,
        "action": action,
        "message": plan.get("message") or f"Updated playbook '{chosen_name}' (v{saved['version']}).",
        "playbook": saved,
        "playbooks": updated_all,
    }


def is_explicit_playbook_edit_intent(message: str) -> bool:
    """Strict detector for chat routing: triggers only when message explicitly edits a playbook/pipeline."""
    low = (message or "").lower()
    has_subject = any(w in low for w in ("playbook", "pipeline"))
    has_verb = bool(
        re.search(
            r"\b(add|insert|append|prepend|remove|delete|drop|edit|update|set|change|replace|rename|move|reorder|create|make|build)\b",
            low,
        )
    )
    return has_subject and has_verb
