"""Tier 1: Feature Coverage — Next.js Server-Side Web Proxy."""
import pytest
from tests.e2e.client import CawrysClient


def test_01_proxy_authenticated_request(client: CawrysClient, engineer_token: str):
    resp = client.web_proxy_request(
        service="intelligence",
        path="v1/auth/me",
        method="GET",
        cookie_token=engineer_token,
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.data}"
    assert resp.data.get("role") == "engineer"


def test_02_proxy_unauthenticated_request(client: CawrysClient):
    resp = client.web_proxy_request(
        service="intelligence",
        path="v1/auth/me",
        method="GET",
        cookie_token=None,
    )
    assert resp.status_code == 401, f"Expected 401 Unauthorized, got {resp.status_code}"


def test_03_proxy_csrf_origin_guard(client: CawrysClient, engineer_token: str):
    # Cross-origin request on POST must be blocked by CSRF guard
    resp = client.web_proxy_request(
        service="execution",
        path="v1/executions",
        method="POST",
        json_body={"playbook": "production-setup"},
        cookie_token=engineer_token,
        origin="http://evil-attacker-site.com",
        host="localhost:3000",
    )
    assert resp.status_code == 403, f"Expected 403 Forbidden CSRF guard, got {resp.status_code}"


def test_04_proxy_path_traversal_blocked(client: CawrysClient, engineer_token: str):
    # Directory traversal via ..
    resp = client.web_proxy_request(
        service="intelligence",
        path="v1/../../etc/passwd",
        method="GET",
        cookie_token=engineer_token,
    )
    assert resp.status_code == 400, f"Expected 400 Bad Request, got {resp.status_code}"


def test_05_proxy_login_route_forbidden(client: CawrysClient):
    # Directly proxying login is blocked (clients must use /api/login)
    resp = client.web_proxy_request(
        service="intelligence",
        path="v1/auth/login",
        method="POST",
        json_body={"email": "engineer@cawrys.local", "password": "pass"},
    )
    assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"


def test_06_proxy_unknown_service_404(client: CawrysClient, engineer_token: str):
    resp = client.web_proxy_request(
        service="unregistered_service_xyz",
        path="v1/resource",
        method="GET",
        cookie_token=engineer_token,
    )
    assert resp.status_code == 404, f"Expected 404 Not Found, got {resp.status_code}"
