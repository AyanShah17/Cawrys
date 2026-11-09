"""Tier 2: Boundary & Corner Cases — SSRF, CSRF & Path Traversal Guards."""
import pytest
from tests.e2e.client import CawrysClient


def test_01_proxy_url_encoded_traversal_blocked(client: CawrysClient, engineer_token: str):
    # Encoded dot-dot traversal
    resp = client.web_proxy_request(
        service="intelligence",
        path="v1/%2e%2e/%2e%2e/etc/passwd",
        method="GET",
        cookie_token=engineer_token,
    )
    assert resp.status_code == 400


def test_02_proxy_backslash_traversal_blocked(client: CawrysClient, engineer_token: str):
    resp = client.web_proxy_request(
        service="intelligence",
        path="v1\\..\\windows\\win.ini",
        method="GET",
        cookie_token=engineer_token,
    )
    assert resp.status_code == 400


def test_03_proxy_single_dot_path_blocked(client: CawrysClient, engineer_token: str):
    resp = client.web_proxy_request(
        service="intelligence",
        path="v1/./auth/me",
        method="GET",
        cookie_token=engineer_token,
    )
    assert resp.status_code == 400


def test_04_proxy_cross_origin_mutating_blocked(client: CawrysClient, engineer_token: str):
    resp = client.web_proxy_request(
        service="execution",
        path="v1/executions",
        method="POST",
        json_body={"playbook": "production-setup"},
        cookie_token=engineer_token,
        origin="https://attacker.external.domain",
        host="localhost:3000",
    )
    assert resp.status_code == 403
