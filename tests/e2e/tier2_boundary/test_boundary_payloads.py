"""Tier 2: Boundary & Corner Cases — Payload & File Boundaries."""
import pytest
from tests.e2e.client import CawrysClient


def test_01_empty_file_upload_rejected(client: CawrysClient, engineer_token: str):
    resp = client.upload_document(filename="empty.txt", content="", token=engineer_token)
    assert resp.status_code == 400, f"Expected 400 Bad Request, got {resp.status_code}"
    assert "empty file" in str(resp.data).lower()


def test_02_edge_ingest_empty_file_rejected(client: CawrysClient, engineer_token: str):
    resp = client.edge_ingest_file(filename="edge_empty.txt", content="", token=engineer_token)
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"


def test_03_edge_event_oversized_payload(client: CawrysClient):
    # Sensor event exceeding 1MB
    large_payload = {"sensor_id": "STRESS-TEST", "payload": "A" * (1024 * 1024 + 100)}
    resp = client.edge_ingest_event(large_payload)
    assert resp.status_code in (400, 413), f"Expected 400 or 413, got {resp.status_code}"


def test_04_edge_event_empty_body(client: CawrysClient):
    url = f"{client.edge_url}/ingest/event"
    headers = {"Content-Type": "application/json", "X-API-Key": client.edge_api_key}
    resp = client._http_request(url, method="POST", headers=headers, data="")
    assert resp.status_code == 400, f"Expected 400 for empty event, got {resp.status_code}"
