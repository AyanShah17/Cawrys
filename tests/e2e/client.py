"""Cawrys E2E HTTP Client Helper.

Provides a unified interface for testing Intelligence, Execution, Edge-Ingest,
and Next.js Web Proxy services over standard HTTP.
"""
import io
import json
import os
import time
from typing import Any, Dict, Optional, Tuple, Union
import urllib.parse
import urllib.request
import urllib.error
import jwt

INTELLIGENCE_URL = os.environ.get("INTELLIGENCE_URL", "http://localhost:8001")
EXECUTION_URL = os.environ.get("EXECUTION_URL", "http://localhost:8002")
EDGE_INGEST_URL = os.environ.get("EDGE_INGEST_URL", "http://localhost:8080")
WEB_URL = os.environ.get("WEB_URL", "http://localhost:3000")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "cawrys-demo")
EDGE_API_KEY = os.environ.get("EDGE_API_KEY", "cawrys-edge-test-key")
AUTH_SECRET = os.environ.get("AUTH_SECRET", "dev-insecure-secret-change-me-32-bytes!")
DEFAULT_TENANT = "00000000-0000-0000-0000-000000000001"


class ApiResponse:
    def __init__(self, status_code: int, data: Any, headers: Dict[str, str], raw_body: bytes):
        self.status_code = status_code
        self.data = data
        self.headers = headers
        self.raw_body = raw_body

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> Any:
        return self.data


def make_custom_token(
    user_id: str = "00000000-0000-0000-0000-000000000002",
    tenant_id: str = DEFAULT_TENANT,
    role: str = "engineer",
    email: str = "engineer@cawrys.local",
    secret: str = AUTH_SECRET,
    ttl: int = 3600,
    expired: bool = False,
    extra_claims: Optional[Dict[str, Any]] = None,
) -> str:
    """Generate a JWT token for testing, including expired or tampered tokens."""
    now = int(time.time())
    iat = now - 7200 if expired else now
    exp = now - 3600 if expired else now + ttl
    payload = {
        "sub": user_id,
        "tid": tenant_id,
        "role": role,
        "email": email,
        "iat": iat,
        "exp": exp,
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, secret, algorithm="HS256")


class CawrysClient:
    def __init__(
        self,
        intelligence_url: str = INTELLIGENCE_URL,
        execution_url: str = EXECUTION_URL,
        edge_ingest_url: str = EDGE_INGEST_URL,
        web_url: str = WEB_URL,
        auth_secret: str = AUTH_SECRET,
        edge_api_key: str = EDGE_API_KEY,
    ):
        self.intel_url = intelligence_url.rstrip("/")
        self.exec_url = execution_url.rstrip("/")
        self.edge_url = edge_ingest_url.rstrip("/")
        self.web_url = web_url.rstrip("/")
        self.auth_secret = auth_secret
        self.edge_api_key = edge_api_key
        self.tokens: Dict[str, str] = {}

    def _http_request(
        self,
        url: str,
        method: str = "GET",
        headers: Optional[Dict[str, str]] = None,
        data: Optional[Union[bytes, str]] = None,
    ) -> ApiResponse:
        req_headers = headers.copy() if headers else {}
        if isinstance(data, str):
            data_bytes = data.encode("utf-8")
        else:
            data_bytes = data

        req = urllib.request.Request(url, data=data_bytes, headers=req_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp_bytes = resp.read()
                resp_headers = dict(resp.headers)
                status_code = resp.status
        except urllib.error.HTTPError as e:
            resp_bytes = e.read()
            resp_headers = dict(e.headers)
            status_code = e.code
        except Exception as e:
            return ApiResponse(503, {"error": str(e)}, {}, b"")

        parsed_json = None
        try:
            parsed_json = json.loads(resp_bytes.decode("utf-8"))
        except Exception:
            parsed_json = {"raw": resp_bytes.decode("utf-8", errors="replace")}

        return ApiResponse(status_code, parsed_json, resp_headers, resp_bytes)

    # Authentication & User Management
    def login(self, email_prefix: str, password: str = DEMO_PASSWORD) -> ApiResponse:
        email = f"{email_prefix}@cawrys.local" if "@" not in email_prefix else email_prefix
        url = f"{self.intel_url}/v1/auth/login"
        body = json.dumps({"email": email, "password": password})
        resp = self._http_request(url, method="POST", headers={"Content-Type": "application/json"}, data=body)
        if resp.is_success and isinstance(resp.data, dict) and "token" in resp.data:
            self.tokens[email_prefix] = resp.data["token"]
        return resp

    def get_token(self, role: str) -> str:
        if role in self.tokens:
            return self.tokens[role]
        resp = self.login(role)
        if resp.is_success and "token" in resp.data:
            return resp.data["token"]
        # Fallback to minted token with AUTH_SECRET
        token = make_custom_token(role=role, email=f"{role}@cawrys.local")
        self.tokens[role] = token
        return token

    def signup(self, company: str, email: str, password: str) -> ApiResponse:
        url = f"{self.intel_url}/v1/auth/signup"
        body = json.dumps({"company": company, "email": email, "password": password})
        return self._http_request(url, method="POST", headers={"Content-Type": "application/json"}, data=body)

    def get_me(self, token: Optional[str] = None) -> ApiResponse:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self._http_request(f"{self.intel_url}/v1/auth/me", headers=headers)

    def list_users(self, token: Optional[str] = None) -> ApiResponse:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self._http_request(f"{self.intel_url}/v1/auth/users", headers=headers)

    def create_user(self, email: str, password: str, role: str, token: Optional[str] = None) -> ApiResponse:
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        body = json.dumps({"email": email, "password": password, "role": role})
        return self._http_request(f"{self.intel_url}/v1/auth/users", method="POST", headers=headers, data=body)

    # Ingestion & Documents
    def upload_document(
        self,
        filename: str,
        content: Union[str, bytes],
        mime_type: str = "text/plain",
        token: Optional[str] = None,
    ) -> ApiResponse:
        url = f"{self.intel_url}/v1/documents"
        boundary = "----CawrysTestBoundary12345"
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        data_bytes = content.encode("utf-8") if isinstance(content, str) else content

        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {mime_type}\r\n\r\n"
        ).encode("utf-8") + data_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

        return self._http_request(url, method="POST", headers=headers, data=body)

    def list_documents(self, token: Optional[str] = None, limit: int = 50) -> ApiResponse:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self._http_request(f"{self.intel_url}/v1/documents?limit={limit}", headers=headers)

    def get_document(self, doc_id: str, token: Optional[str] = None) -> ApiResponse:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self._http_request(f"{self.intel_url}/v1/documents/{doc_id}", headers=headers)

    def get_audit(self, token: Optional[str] = None, limit: int = 100) -> ApiResponse:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self._http_request(f"{self.intel_url}/v1/audit?limit={limit}", headers=headers)

    # Execution & Tools
    def list_tools(self, token: Optional[str] = None) -> ApiResponse:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self._http_request(f"{self.exec_url}/v1/tools", headers=headers)

    def register_tool(
        self,
        name: str,
        input_schema: dict,
        connector: str = "log",
        risk: str = "medium",
        description: Optional[str] = None,
        secret_ref: Optional[str] = None,
        token: Optional[str] = None,
    ) -> ApiResponse:
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        payload = {
            "name": name,
            "input_schema": input_schema,
            "connector": connector,
            "risk": risk,
            "description": description,
            "secret_ref": secret_ref,
        }
        return self._http_request(f"{self.exec_url}/v1/tools", method="POST", headers=headers, data=json.dumps(payload))

    def list_playbooks(self, token: Optional[str] = None) -> ApiResponse:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self._http_request(f"{self.exec_url}/v1/playbooks", headers=headers)

    def save_playbook(self, name: str, steps: list, token: Optional[str] = None) -> ApiResponse:
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        payload = {"name": name, "steps": steps}
        return self._http_request(f"{self.exec_url}/v1/playbooks", method="POST", headers=headers, data=json.dumps(payload))

    def create_execution(
        self,
        playbook: str,
        token: Optional[str] = None,
        extraction_id: Optional[str] = None,
        inputs: Optional[dict] = None,
    ) -> ApiResponse:
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        payload = {
            "playbook": playbook,
            "extraction_id": extraction_id,
            "inputs": inputs or {},
        }
        return self._http_request(f"{self.exec_url}/v1/executions", method="POST", headers=headers, data=json.dumps(payload))

    def approve_execution(self, exec_id: str, token: Optional[str] = None) -> ApiResponse:
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return self._http_request(f"{self.exec_url}/v1/executions/{exec_id}/approve", method="POST", headers=headers)

    def reject_execution(self, exec_id: str, token: Optional[str] = None) -> ApiResponse:
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return self._http_request(f"{self.exec_url}/v1/executions/{exec_id}/reject", method="POST", headers=headers)

    def list_executions(self, token: Optional[str] = None, limit: int = 50) -> ApiResponse:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self._http_request(f"{self.exec_url}/v1/executions?limit={limit}", headers=headers)

    # Edge Ingest
    def edge_ingest_file(
        self,
        filename: str,
        content: Union[str, bytes],
        token: Optional[str] = None,
    ) -> ApiResponse:
        url = f"{self.edge_url}/ingest/file"
        boundary = "----CawrysEdgeBoundary98765"
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        data_bytes = content.encode("utf-8") if isinstance(content, str) else content

        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: text/plain\r\n\r\n"
        ).encode("utf-8") + data_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

        return self._http_request(url, method="POST", headers=headers, data=body)

    def edge_ingest_event(self, payload: dict, api_key: Optional[str] = None) -> ApiResponse:
        url = f"{self.edge_url}/ingest/event"
        headers = {"Content-Type": "application/json"}
        key = api_key if api_key is not None else self.edge_api_key
        if key:
            headers["X-API-Key"] = key
        return self._http_request(url, method="POST", headers=headers, data=json.dumps(payload))

    # Next.js Web Proxy
    def web_proxy_request(
        self,
        service: str,
        path: str,
        method: str = "GET",
        json_body: Optional[dict] = None,
        cookie_token: Optional[str] = None,
        origin: Optional[str] = None,
        host: str = "localhost:3000",
    ) -> ApiResponse:
        url = f"{self.web_url}/api/{service}/{path.lstrip('/')}"
        headers = {"Host": host}
        if origin:
            headers["Origin"] = origin
        if cookie_token:
            headers["Cookie"] = f"cawrys_token={cookie_token}"
        data = None
        if json_body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(json_body)
        return self._http_request(url, method=method, headers=headers, data=data)

