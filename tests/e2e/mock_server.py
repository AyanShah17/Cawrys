"""Cawrys Self-Contained E2E Mock Server.

Implements faithful HTTP simulation of Intelligence (8001), Execution (8002),
Edge-Ingest (8080), and Web Proxy (3000) for zero-dependency offline verification.
Can run standalone or be dynamically spawned by the test runner.
"""
import http.server
import io
import json
import os
import re
import socketserver
import threading
import time
import urllib.parse
import uuid
import jwt

AUTH_SECRET = os.environ.get("AUTH_SECRET", "dev-insecure-secret-change-me-32-bytes!")
DEFAULT_TENANT = "00000000-0000-0000-0000-000000000001"
EDGE_API_KEY = os.environ.get("EDGE_API_KEY", "cawrys-edge-test-key")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "cawrys-demo")
ROLES = ("admin", "engineer", "approver", "viewer")
FORBIDDEN_CONNECTORS = {"plc", "machine_direct"}


class MockState:
    """Thread-safe in-memory state store mimicking the Cawrys database."""

    def __init__(self):
        self.lock = threading.RLock()
        self.tenants = {DEFAULT_TENANT: {"name": "Demo Tenant"}}
        self.users = {}
        self.documents = {}
        self.extractions = {}
        self.tools = {}
        self.playbooks = {}
        self.executions = {}
        self.audit_log = []
        self._seed_demo()

    def _seed_demo(self):
        for role in ROLES:
            uid = str(uuid.uuid4())
            self.users[f"{role}@cawrys.local"] = {
                "id": uid,
                "tenant_id": DEFAULT_TENANT,
                "email": f"{role}@cawrys.local",
                "role": role,
                "password": DEMO_PASSWORD,
                "created_at": time.time(),
            }
        demo_tools = [
            {
                "name": "erp_lookup_inventory",
                "description": "Check material availability in the ERP",
                "input_schema": {"type": "object", "required": ["material"], "properties": {"material": {"type": "string"}}},
                "connector": "log",
                "risk": "low",
            },
            {
                "name": "schedule_production",
                "description": "Create a production order in the MES",
                "input_schema": {
                    "type": "object",
                    "required": ["drawing_id", "quantity"],
                    "properties": {"drawing_id": {"type": ["string", "number"]}, "quantity": {"type": "number"}},
                },
                "connector": "log",
                "risk": "medium",
            },
            {
                "name": "notify_team",
                "description": "Notify the production team",
                "input_schema": {"type": "object", "required": ["message"], "properties": {"message": {"type": "string"}}},
                "connector": "log",
                "risk": "low",
            },
        ]
        for t in demo_tools:
            self.tools[(DEFAULT_TENANT, t["name"])] = t
        self.playbooks[(DEFAULT_TENANT, "production-setup", 1)] = {
            "id": str(uuid.uuid4()),
            "tenant_id": DEFAULT_TENANT,
            "name": "production-setup",
            "version": 1,
            "steps": [
                {"tool": "erp_lookup_inventory", "params": {"material": "$inputs.material"}},
                {"tool": "schedule_production", "params": {"drawing_id": "$inputs.drawing_id", "quantity": "$inputs.quantity"}},
                {"tool": "notify_team", "params": {"message": "Production order scheduled for $inputs.drawing_id"}},
            ],
        }

    def audit(self, tenant_id, actor, service, event, workflow_id=None, detail=None):
        with self.lock:
            self.audit_log.insert(0, {
                "id": len(self.audit_log) + 1,
                "tenant_id": tenant_id,
                "actor": actor,
                "service": service,
                "event": event,
                "workflow_id": workflow_id,
                "detail": detail or {},
                "created_at": time.time(),
            })


STATE = MockState()


def verify_token(auth_header: str) -> dict:
    if not auth_header or not auth_header.lower().startswith("bearer "):
        raise ValueError((401, "missing bearer token"))
    token = auth_header[7:].strip()
    try:
        claims = jwt.decode(token, AUTH_SECRET, algorithms=["HS256"], options={"require": ["exp", "sub", "tid", "role"]})
    except jwt.PyJWTError:
        raise ValueError((401, "invalid or expired token"))
    if claims["role"] not in ROLES:
        raise ValueError((401, "invalid role in token"))
    return claims


def parse_multipart_file(body_bytes: bytes, content_type: str) -> tuple[str, bytes]:
    # Extract boundary
    m = re.search(r'boundary=([^;]+)', content_type)
    if not m:
        return "upload.txt", body_bytes
    boundary = m.group(1).strip('"')
    parts = body_bytes.split(f"--{boundary}".encode())
    for part in parts:
        if b'Content-Disposition' in part and b'filename=' in part:
            header_end = part.find(b"\r\n\r\n")
            if header_end != -1:
                headers = part[:header_end].decode("utf-8", errors="replace")
                data = part[header_end + 4:]
                if data.endswith(b"\r\n"):
                    data = data[:-2]
                fn_m = re.search(r'filename="([^"]+)"', headers)
                filename = fn_m.group(1) if fn_m else "upload.txt"
                return filename, data
    return "upload.txt", b""


def deterministic_extract_and_reason(text: str):
    fields, conf = {}, {}
    for line in text.splitlines():
        m = re.match(r"\s*([A-Za-z][A-Za-z0-9 _/().-]{1,40}?)\s*[:=]\s*(.+?)\s*$", line)
        if m:
            key = re.sub(r"[^a-z0-9]+", "_", m.group(1).lower()).strip("_")
            raw_v = m.group(2).strip()
            try:
                val = int(raw_v)
            except ValueError:
                try:
                    val = float(raw_v)
                except ValueError:
                    val = raw_v
            fields[key] = val
            conf[key] = 0.95

    is_drawing = "drawing" in text.lower() or "drawing_id" in fields
    doc_type = "technical_drawing" if is_drawing else "document"
    missing = [k for k in ["drawing_id", "material", "quantity"] if k not in fields] if is_drawing else []

    issues = []
    if missing:
        issues.append({"type": "missing_fields", "fields": missing})
    for k, v in fields.items():
        if isinstance(v, (int, float)) and v < 0 and any(t in k.lower() for t in ("qty", "quantity", "dimension", "length")):
            issues.append({"type": "negative_value", "field": k, "value": v})

    scores = [c for c in conf.values() if isinstance(c, (int, float))]
    overall = round(sum(scores) / len(scores), 3) if scores else 0.0
    needs_review = bool(issues) or overall < 0.8
    validation = {
        "issues": issues,
        "null_fields": [],
        "overall_confidence": overall,
        "passed": not issues,
        "needs_review": needs_review,
    }

    actions = []
    if doc_type == "technical_drawing" and not issues:
        actions.append({"action": "run_playbook:production-setup", "params": fields, "risk": "medium"})
    questions = [f"Resolve: {i['type']}" for i in issues]
    decision = {
        "summary": f"{doc_type} with {len(fields)} extracted fields.",
        "proposed_actions": actions,
        "open_questions": questions,
    }
    status = "needs_review" if (needs_review or any(a.get("risk") == "high" for a in actions)) else "ready"
    return doc_type, fields, validation, decision, status


class UnifiedDispatcher(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Quiet logs during test execution

    def _send_json(self, status: int, data: any):
        resp_bytes = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(resp_bytes)))
        self.end_headers()
        self.wfile.write(resp_bytes)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length > 0 else b""

    def do_GET(self):
        port = self.server.server_address[1]
        path = self.path.split("?")[0]
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)

        # Web proxy port (3000)
        if port == 3000:
            self._handle_web_proxy("GET", path, qs)
            return

        # Edge Ingest port (8080)
        if port == 8080:
            if path == "/health":
                self._send_json(200, {"ok": True, "service": "edge-ingest"})
                return
            self._send_json(404, {"detail": "not found"})
            return

        # Intelligence service (8001)
        if port == 8001:
            if path == "/health":
                self._send_json(200, {"ok": True, "service": "intelligence"})
                return
            try:
                claims = verify_token(self.headers.get("Authorization", ""))
            except ValueError as e:
                self._send_json(e.args[0][0], {"detail": e.args[0][1]})
                return

            if path == "/v1/auth/me":
                self._send_json(200, {"email": claims["email"], "role": claims["role"], "tenant_id": claims["tid"]})
                return
            if path == "/v1/auth/users":
                if claims["role"] != "admin":
                    self._send_json(403, {"detail": "requires role: admin"})
                    return
                with STATE.lock:
                    users = [
                        {"id": u["id"], "email": u["email"], "role": u["role"], "created_at": u["created_at"]}
                        for u in STATE.users.values()
                        if u["tenant_id"] == claims["tid"]
                    ]
                self._send_json(200, users)
                return
            if path == "/v1/documents":
                with STATE.lock:
                    docs = [
                        {
                            "id": d["id"],
                            "filename": d["filename"],
                            "status": d["status"],
                            "created_at": d["created_at"],
                            "doc_type": STATE.extractions.get(d["id"], {}).get("doc_type"),
                            "confidence": STATE.extractions.get(d["id"], {}).get("confidence"),
                        }
                        for d in STATE.documents.values()
                        if d["tenant_id"] == claims["tid"]
                    ]
                self._send_json(200, docs)
                return
            if path.startswith("/v1/documents/"):
                doc_id = path[len("/v1/documents/") :]
                with STATE.lock:
                    d = STATE.documents.get(doc_id)
                    if not d or d["tenant_id"] != claims["tid"]:
                        self._send_json(404, {"detail": "not found"})
                        return
                    ext = STATE.extractions.get(doc_id, {})
                    res = {**d, **ext}
                self._send_json(200, res)
                return
            if path == "/v1/audit":
                limit = int(qs.get("limit", [100])[0])
                with STATE.lock:
                    logs = [l for l in STATE.audit_log if l["tenant_id"] == claims["tid"]][:limit]
                self._send_json(200, logs)
                return
            self._send_json(404, {"detail": "not found"})
            return

        # Execution service (8002)
        if port == 8002:
            if path == "/health":
                self._send_json(200, {"ok": True, "service": "execution"})
                return
            try:
                claims = verify_token(self.headers.get("Authorization", ""))
            except ValueError as e:
                self._send_json(e.args[0][0], {"detail": e.args[0][1]})
                return

            if path == "/v1/tools":
                with STATE.lock:
                    tools = [
                        {"name": t["name"], "description": t.get("description"), "input_schema": t["input_schema"], "connector": t["connector"], "risk": t["risk"]}
                        for (tid, _), t in STATE.tools.items()
                        if tid == claims["tid"]
                    ]
                self._send_json(200, tools)
                return
            if path == "/v1/playbooks":
                with STATE.lock:
                    pbs = [
                        {"name": pb["name"], "version": pb["version"], "steps": pb["steps"]}
                        for (tid, _, _), pb in STATE.playbooks.items()
                        if tid == claims["tid"]
                    ]
                self._send_json(200, pbs)
                return
            if path == "/v1/executions":
                with STATE.lock:
                    execs = [
                        {"id": ex["id"], "status": ex["status"], "extraction_id": ex.get("extraction_id"), "created_at": ex["created_at"], "result": ex.get("result")}
                        for ex in STATE.executions.values()
                        if ex["tenant_id"] == claims["tid"]
                    ]
                self._send_json(200, execs)
                return
            self._send_json(404, {"detail": "not found"})
            return

    def do_POST(self):
        port = self.server.server_address[1]
        path = self.path.split("?")[0]
        body = self._read_body()

        # Web proxy (3000)
        if port == 3000:
            self._handle_web_proxy("POST", path, {}, body)
            return

        # Edge Ingest (8080)
        if port == 8080:
            if path == "/ingest/file":
                auth = self.headers.get("Authorization", "")
                if not auth:
                    self._send_json(401, {"detail": "missing bearer token"})
                    return
                if len(body) > 50 * 1024 * 1024:
                    self._send_json(400, {"detail": "payload too large"})
                    return
                # Forward to Intelligence service
                filename, file_data = parse_multipart_file(body, self.headers.get("Content-Type", ""))
                return self._process_document_upload(auth, filename, file_data)

            if path == "/ingest/event":
                key = self.headers.get("X-API-Key", "")
                if key != EDGE_API_KEY:
                    self._send_json(401, {"detail": "unauthorized"})
                    return
                if len(body) > 1024 * 1024:
                    self._send_json(400, {"detail": "payload too large"})
                    return
                try:
                    ev = json.loads(body.decode("utf-8"))
                    if not isinstance(ev, dict):
                        raise ValueError()
                except Exception:
                    self._send_json(400, {"detail": "invalid json"})
                    return
                self._send_json(202, {"accepted": True})
                return
            self._send_json(404, {"detail": "not found"})
            return

        # Intelligence service (8001)
        if port == 8001:
            if path == "/v1/auth/login":
                try:
                    payload = json.loads(body.decode("utf-8"))
                    email = payload["email"].strip().lower()
                    pwd = payload["password"]
                except Exception:
                    self._send_json(400, {"detail": "invalid body"})
                    return
                with STATE.lock:
                    user = STATE.users.get(email)
                if not user or user["password"] != pwd:
                    if user:
                        STATE.audit(user["tenant_id"], email, "intelligence", "auth.login_failed", detail={"email": email})
                    self._send_json(401, {"detail": "invalid email or password"})
                    return
                token = jwt.encode(
                    {"sub": user["id"], "tid": user["tenant_id"], "role": user["role"], "email": user["email"], "iat": int(time.time()), "exp": int(time.time()) + 3600},
                    AUTH_SECRET,
                    algorithm="HS256",
                )
                STATE.audit(user["tenant_id"], email, "intelligence", "auth.login")
                self._send_json(200, {"token": token, "user": {"email": user["email"], "role": user["role"], "tenant_id": user["tenant_id"]}})
                return

            if path == "/v1/auth/signup":
                if os.environ.get("ALLOW_SIGNUP", "0") != "1":
                    self._send_json(403, {"detail": "signup is disabled; ask an admin to create your account"})
                    return
                payload = json.loads(body.decode("utf-8"))
                email = payload["email"].strip().lower()
                with STATE.lock:
                    if email in STATE.users:
                        self._send_json(409, {"detail": "email already registered"})
                        return
                    tid = str(uuid.uuid4())
                    uid = str(uuid.uuid4())
                    user = {"id": uid, "tenant_id": tid, "email": email, "role": "admin", "password": payload["password"], "created_at": time.time()}
                    STATE.users[email] = user
                token = jwt.encode({"sub": uid, "tid": tid, "role": "admin", "email": email, "iat": int(time.time()), "exp": int(time.time()) + 3600}, AUTH_SECRET, algorithm="HS256")
                STATE.audit(tid, email, "intelligence", "tenant.created", detail={"company": payload.get("company")})
                self._send_json(200, {"token": token, "user": {"email": email, "role": "admin", "tenant_id": tid}})
                return

            # Protected routes
            try:
                claims = verify_token(self.headers.get("Authorization", ""))
            except ValueError as e:
                self._send_json(e.args[0][0], {"detail": e.args[0][1]})
                return

            if path == "/v1/auth/users":
                if claims["role"] != "admin":
                    self._send_json(403, {"detail": "requires role: admin"})
                    return
                try:
                    payload = json.loads(body.decode("utf-8"))
                    email = payload["email"].strip().lower()
                    pwd = payload["password"]
                    role = payload["role"]
                except Exception:
                    self._send_json(400, {"detail": "invalid body"})
                    return
                if len(pwd) < 8:
                    self._send_json(422, {"detail": "password must be at least 8 characters"})
                    return
                if role not in ROLES:
                    self._send_json(400, {"detail": f"role must be one of {', '.join(ROLES)}"})
                    return
                with STATE.lock:
                    if email in STATE.users:
                        self._send_json(409, {"detail": "email already registered"})
                        return
                    uid = str(uuid.uuid4())
                    STATE.users[email] = {"id": uid, "tenant_id": claims["tid"], "email": email, "role": role, "password": pwd, "created_at": time.time()}
                    STATE.audit(claims["tid"], claims["email"], "intelligence", "user.created", detail={"email": email, "role": role})
                self._send_json(200, {"email": email, "role": role})
                return

            if path == "/v1/documents":
                if claims["role"] not in ("admin", "engineer"):
                    self._send_json(403, {"detail": "requires role: admin, engineer"})
                    return
                filename, file_data = parse_multipart_file(body, self.headers.get("Content-Type", ""))
                return self._process_document_upload(self.headers.get("Authorization", ""), filename, file_data)

            self._send_json(404, {"detail": "not found"})
            return

        # Execution service (8002)
        if port == 8002:
            try:
                claims = verify_token(self.headers.get("Authorization", ""))
            except ValueError as e:
                self._send_json(e.args[0][0], {"detail": e.args[0][1]})
                return

            if path == "/v1/tools":
                if claims["role"] not in ("admin", "engineer"):
                    self._send_json(403, {"detail": "requires role: admin, engineer"})
                    return
                payload = json.loads(body.decode("utf-8"))
                name = payload.get("name")
                schema = payload.get("input_schema", {})
                if not isinstance(schema, dict):
                    self._send_json(422, {"detail": "invalid input_schema"})
                    return
                try:
                    import jsonschema
                    jsonschema.Draft202012Validator.check_schema(schema)
                except Exception as e:
                    self._send_json(422, {"detail": f"invalid input_schema: {e}"})
                    return
                with STATE.lock:
                    STATE.tools[(claims["tid"], name)] = payload
                    STATE.audit(claims["tid"], claims["email"], "execution", "tool.registered", detail={"name": name})
                self._send_json(200, {"ok": True})
                return

            if path == "/v1/playbooks":
                if claims["role"] not in ("admin", "engineer"):
                    self._send_json(403, {"detail": "requires role: admin, engineer"})
                    return
                payload = json.loads(body.decode("utf-8"))
                name = payload.get("name")
                steps = payload.get("steps", [])
                with STATE.lock:
                    v = 1
                    key = (claims["tid"], name, v)
                    STATE.playbooks[key] = {"id": str(uuid.uuid4()), "tenant_id": claims["tid"], "name": name, "version": v, "steps": steps}
                    STATE.audit(claims["tid"], claims["email"], "execution", "playbook.saved", detail={"name": name, "version": v})
                self._send_json(200, {"name": name, "version": v})
                return

            if path == "/v1/executions":
                payload = json.loads(body.decode("utf-8"))
                pb_name = payload.get("playbook")
                ext_id = payload.get("extraction_id")
                inputs = payload.get("inputs", {})

                with STATE.lock:
                    pb = next((p for (tid, n, _), p in STATE.playbooks.items() if tid == claims["tid"] and n == pb_name), None)
                    if not pb:
                        self._send_json(404, {"detail": "playbook not found"})
                        return
                    if ext_id:
                        ext = next((e for e in STATE.extractions.values() if e.get("id") == ext_id and e.get("tenant_id") == claims["tid"]), None)
                        if not ext:
                            self._send_json(404, {"detail": "extraction not found"})
                            return
                        inputs = {**(ext.get("fields") or {}), **inputs}

                    exec_id = str(uuid.uuid4())
                    status, results, reason = self._execute_steps(claims["tid"], exec_id, pb["steps"], inputs, claims["role"], False)
                    STATE.executions[exec_id] = {
                        "id": exec_id,
                        "tenant_id": claims["tid"],
                        "playbook_id": pb["id"],
                        "extraction_id": ext_id,
                        "status": status,
                        "created_at": time.time(),
                        "result": {"results": results, "reason": reason, "inputs": inputs, "playbook": pb_name},
                    }
                    STATE.audit(claims["tid"], claims["email"], "execution", f"execution.{status}", workflow_id=exec_id, detail={"playbook": pb_name, "role": claims["role"]})
                self._send_json(200, {"execution_id": exec_id, "status": status, "reason": reason, "results": results})
                return

            if re.match(r"^/v1/executions/[^/]+/approve$", path):
                exec_id = path.split("/")[3]
                if claims["role"] not in ("admin", "approver"):
                    self._send_json(403, {"detail": "requires role: admin, approver"})
                    return
                with STATE.lock:
                    ex = STATE.executions.get(exec_id)
                    if not ex or ex["tenant_id"] != claims["tid"] or ex["status"] != "awaiting_approval":
                        self._send_json(409, {"detail": "not awaiting approval"})
                        return
                    pb = next((p for p in STATE.playbooks.values() if p["id"] == ex["playbook_id"]), None)
                    prior = ex["result"]
                    status, results, reason = self._execute_steps(claims["tid"], exec_id, pb["steps"], prior.get("inputs", {}), claims["role"], True, prior.get("results", []))
                    ex["status"] = status
                    ex["result"] = {**prior, "results": results, "reason": reason}
                    STATE.audit(claims["tid"], claims["email"], "execution", f"execution.approved.{status}", workflow_id=exec_id, detail={"role": claims["role"]})
                self._send_json(200, {"execution_id": exec_id, "status": status, "results": results})
                return

            if re.match(r"^/v1/executions/[^/]+/reject$", path):
                exec_id = path.split("/")[3]
                if claims["role"] not in ("admin", "approver"):
                    self._send_json(403, {"detail": "requires role: admin, approver"})
                    return
                with STATE.lock:
                    ex = STATE.executions.get(exec_id)
                    if not ex or ex["tenant_id"] != claims["tid"] or ex["status"] != "awaiting_approval":
                        self._send_json(409, {"detail": "not awaiting approval"})
                        return
                    ex["status"] = "rejected"
                    ex["result"]["reason"] = f"rejected by {claims['role']}"
                    STATE.audit(claims["tid"], claims["email"], "execution", "execution.rejected", workflow_id=exec_id, detail={"role": claims["role"]})
                self._send_json(200, {"execution_id": exec_id, "status": "rejected"})
                return

            self._send_json(404, {"detail": "not found"})
            return

    def _process_document_upload(self, auth_header: str, filename: str, file_data: bytes):
        try:
            claims = verify_token(auth_header)
        except ValueError as e:
            self._send_json(e.args[0][0], {"detail": e.args[0][1]})
            return
        if not file_data:
            self._send_json(400, {"detail": "empty file"})
            return

        text = file_data.decode("utf-8", errors="replace")
        doc_id = str(uuid.uuid4())
        ext_id = str(uuid.uuid4())
        doc_type, fields, validation, decision, status = deterministic_extract_and_reason(text)

        with STATE.lock:
            STATE.documents[doc_id] = {
                "id": doc_id,
                "tenant_id": claims["tid"],
                "filename": filename,
                "mime_type": "text/plain",
                "storage_key": f"{claims['tid']}/{doc_id}/{filename}",
                "status": status,
                "created_at": time.time(),
            }
            STATE.extractions[doc_id] = {
                "id": ext_id,
                "document_id": doc_id,
                "tenant_id": claims["tid"],
                "doc_type": doc_type,
                "fields": fields,
                "confidence": validation["overall_confidence"],
                "validation": validation,
                "decision": decision,
            }
            STATE.audit(claims["tid"], claims["email"], "intelligence", "document.received", workflow_id=doc_id, detail={"kind": "text"})
            STATE.audit(claims["tid"], claims["email"], "intelligence", "document.processed", workflow_id=doc_id, detail={"status": status, "extraction_id": ext_id})

        self._send_json(200, {
            "document_id": doc_id,
            "extraction_id": ext_id,
            "status": status,
            "doc_type": doc_type,
            "fields": fields,
            "validation": validation,
            "decision": decision,
        })

    def _execute_steps(self, tenant_id, exec_id, steps, inputs, role, approved, done=None):
        results = list(done or [])
        if role == "viewer":
            STATE.audit(tenant_id, role, "execution", "policy.deny", workflow_id=exec_id, detail={"reason": "viewer role cannot execute"})
            return "rejected", results, "viewer role cannot execute"

        for i in range(len(results), len(steps)):
            step = steps[i]
            tool = STATE.tools.get((tenant_id, step["tool"]))
            if not tool:
                raise ValueError((400, f"unknown tool: {step['tool']}"))

            if tool.get("connector") in FORBIDDEN_CONNECTORS:
                reason = "direct equipment actuation is blocked; route via an interlocked MES/safety gateway"
                STATE.audit(tenant_id, role, "execution", "policy.deny", workflow_id=exec_id, detail={"step": i, "tool": tool["name"], "reason": reason})
                return "rejected", results, reason

            if tool.get("risk") in ("medium", "high") and not approved:
                reason = f"{tool['risk']} risk requires human approval"
                STATE.audit(tenant_id, role, "execution", "policy.needs_approval", workflow_id=exec_id, detail={"step": i, "tool": tool["name"], "reason": reason})
                return "awaiting_approval", results, reason

            STATE.audit(tenant_id, role, "execution", "policy.allow", workflow_id=exec_id, detail={"step": i, "tool": tool["name"]})
            STATE.audit(tenant_id, role, "execution", "tool.executed", workflow_id=exec_id, detail={"step": i, "tool": tool["name"]})
            results.append({"step": i, "tool": tool["name"], "result": {"logged": True}})

        return "succeeded", results, "ok"

    def _handle_web_proxy(self, method: str, path: str, qs: dict, body: bytes = b""):
        # Path: /api/[service]/[...path]
        parts = [p for p in path.split("/") if p]
        if len(parts) < 3 or parts[0] != "api":
            self._send_json(404, {"detail": "unknown service"})
            return
        service = parts[1]
        subpath = parts[2:]
        if service not in ("intelligence", "execution"):
            self._send_json(404, {"detail": "unknown service"})
            return
        if subpath[0] != "v1" or any(p in ("..", ".") or "%" in p or "\\" in p for p in subpath):
            self._send_json(400, {"detail": "invalid path"})
            return
        if len(subpath) >= 3 and subpath[1] == "auth" and subpath[2] == "login":
            self._send_json(404, {"detail": "use /api/login"})
            return

        # CSRF Origin check
        if method != "GET":
            origin = self.headers.get("Origin")
            host = self.headers.get("Host")
            if origin:
                origin_host = urllib.parse.urlparse(origin).netloc
                if origin_host and origin_host != host:
                    self._send_json(403, {"detail": "cross-origin request refused"})
                    return

        # Cookie token check
        cookie_header = self.headers.get("Cookie", "")
        token = None
        for cookie in cookie_header.split(";"):
            cookie = cookie.strip()
            if cookie.startswith("cawrys_token="):
                token = cookie[len("cawrys_token=") :]
                break
        if not token:
            self._send_json(401, {"detail": "not signed in"})
            return

        # Forward internally
        upstream_port = 8001 if service == "intelligence" else 8002
        upstream_url = f"http://127.0.0.1:{upstream_port}/{'/'.join(subpath)}"
        if qs:
            upstream_url += "?" + urllib.parse.urlencode(qs, doseq=True)

        req_headers = {"Authorization": f"Bearer {token}", "Content-Type": self.headers.get("Content-Type", "application/json")}
        req = urllib.request.Request(upstream_url, data=body if method != "GET" else None, headers=req_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = resp.read()
                status = resp.status
        except urllib.error.HTTPError as e:
            data = e.read()
            status = e.code
        except Exception as e:
            self._send_json(502, {"detail": f"{service} service unreachable"})
            return

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


class MockServerManager:
    def __init__(self, ports=(8001, 8002, 8080, 3000)):
        self.ports = ports
        self.servers = []
        self.threads = []

    def start(self):
        for port in self.ports:
            # Check if port is already running
            s = socketserver.TCPServer
            try:
                server = ThreadedTCPServer(("0.0.0.0", port), UnifiedDispatcher)
                t = threading.Thread(target=server.serve_forever, daemon=True)
                t.start()
                self.servers.append(server)
                self.threads.append(t)
            except OSError:
                # Port already bound / service already running
                pass

    def stop(self):
        for server in self.servers:
            try:
                server.shutdown()
                server.server_close()
            except Exception:
                pass


if __name__ == "__main__":
    mgr = MockServerManager()
    mgr.start()
    print("Cawrys mock servers running on ports 8001, 8002, 8080, 3000. Press Ctrl+C to exit.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        mgr.stop()

