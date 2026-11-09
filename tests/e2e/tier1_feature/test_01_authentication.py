"""Tier 1: Feature Coverage — Authentication & RBAC."""
import pytest
from tests.e2e.client import CawrysClient


def test_01_login_valid_credentials(client: CawrysClient):
    for role in ["admin", "engineer", "approver", "viewer"]:
        resp = client.login(role)
        assert resp.status_code == 200, f"Expected 200 for {role}, got {resp.status_code}"
        assert "token" in resp.data
        assert "user" in resp.data
        assert resp.data["user"]["role"] == role
        assert resp.data["user"]["email"] == f"{role}@cawrys.local"


def test_02_login_invalid_password(client: CawrysClient):
    resp = client.login("admin", password="wrong_password_123")
    assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"


def test_03_login_nonexistent_user(client: CawrysClient):
    resp = client.login("nonexistent_user_9999", password="any_password")
    assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"


def test_04_signup_disabled_by_default(client: CawrysClient):
    resp = client.signup(company="Malicious Corp", email="attacker@cawrys.local", password="Password12345!")
    assert resp.status_code == 403, f"Expected 403 Forbidden, got {resp.status_code}"


def test_05_authenticated_me_endpoint(client: CawrysClient, engineer_token: str):
    resp = client.get_me(engineer_token)
    assert resp.status_code == 200
    assert resp.data["role"] == "engineer"
    assert resp.data["email"] == "engineer@cawrys.local"
    assert "tenant_id" in resp.data


def test_06_admin_create_valid_user(client: CawrysClient, admin_token: str):
    email = "test_operator_42@cawrys.local"
    resp = client.create_user(email=email, password="ValidPassword888", role="engineer", token=admin_token)
    assert resp.status_code in (200, 409)  # 200 or 409 if already seeded/created
    if resp.status_code == 200:
        assert resp.data["email"] == email
        assert resp.data["role"] == "engineer"


def test_07_create_user_short_password_rejected(client: CawrysClient, admin_token: str):
    resp = client.create_user(email="shortpw@cawrys.local", password="short", role="viewer", token=admin_token)
    assert resp.status_code == 422, f"Expected 422 for password < 8 chars, got {resp.status_code}"


def test_08_create_user_invalid_role_rejected(client: CawrysClient, admin_token: str):
    resp = client.create_user(email="badrole@cawrys.local", password="ValidPassword888", role="superuser", token=admin_token)
    assert resp.status_code == 400, f"Expected 400 for invalid role, got {resp.status_code}"
