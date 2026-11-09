"""Tier 2: Boundary & Corner Cases — Security, Tokens & Unauthenticated Access."""
import pytest
from tests.e2e.client import CawrysClient, make_custom_token


def test_01_garbage_token_rejected(client: CawrysClient):
    resp = client.get_me(token="abc.def.ghi")
    assert resp.status_code == 401


def test_02_expired_token_rejected(client: CawrysClient):
    expired_token = make_custom_token(expired=True)
    resp = client.get_me(token=expired_token)
    assert resp.status_code == 401


def test_03_tampered_signature_token_rejected(client: CawrysClient):
    tampered_token = make_custom_token(secret="wrong-secret-key-12345-32-bytes-tampered!")
    resp = client.get_me(token=tampered_token)
    assert resp.status_code == 401


def test_04_invalid_role_in_token_rejected(client: CawrysClient):
    bad_role_token = make_custom_token(role="unauthorized_role")
    resp = client.get_me(token=bad_role_token)
    assert resp.status_code == 401


def test_05_unauthenticated_endpoints(client: CawrysClient):
    # Intelligence documents
    assert client.list_documents(token=None).status_code == 401
    # Execution executions
    assert client.list_executions(token=None).status_code == 401
    # Execution tools
    assert client.list_tools(token=None).status_code == 401
    # Execution playbooks
    assert client.list_playbooks(token=None).status_code == 401
