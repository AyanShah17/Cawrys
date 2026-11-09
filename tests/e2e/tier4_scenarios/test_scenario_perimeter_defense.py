"""Tier 4: Real-World Scenario — Perimeter Defense via Next.js Web Proxy."""
import pytest
from tests.e2e.client import CawrysClient


def test_01_csrf_browser_attack_neutralized(client: CawrysClient, engineer_token: str):
    # Simulated Cross-Site Request Forgery attempt
    resp = client.web_proxy_request(
        service="execution",
        path="v1/executions",
        method="POST",
        json_body={"playbook": "production-setup"},
        cookie_token=engineer_token,
        origin="http://phishing-site-cawrys.org",
        host="localhost:3000",
    )
    assert resp.status_code == 403
    assert "cross-origin request refused" in str(resp.data)


def test_02_directory_traversal_exploit_neutralized(client: CawrysClient, engineer_token: str):
    # Directory traversal attack payloads
    traversals = [
        "v1/../../../../etc/shadow",
        "v1/%2e%2e/%2e%2e/env",
        "v1\\..\\app\\config.py",
    ]
    for path in traversals:
        resp = client.web_proxy_request(
            service="intelligence",
            path=path,
            method="GET",
            cookie_token=engineer_token,
        )
        assert resp.status_code == 400, f"Expected 400 for traversal path {path}, got {resp.status_code}"
