"""Tier 1: Feature Coverage — Ingestion (Edge-Ingest & Intelligence)."""
import pytest
from tests.e2e.client import CawrysClient


def test_01_direct_document_upload_engineer(client: CawrysClient, engineer_token: str, valid_drawing_content: str):
    resp = client.upload_document(
        filename="dwg_1042.txt",
        content=valid_drawing_content,
        mime_type="text/plain",
        token=engineer_token,
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.data}"
    assert "document_id" in resp.data
    assert "extraction_id" in resp.data
    assert resp.data["status"] in ("ready", "needs_review")


def test_02_edge_proxy_file_forwarding(client: CawrysClient, engineer_token: str, valid_drawing_content: str):
    resp = client.edge_ingest_file(
        filename="edge_dwg_1042.txt",
        content=valid_drawing_content,
        token=engineer_token,
    )
    assert resp.status_code == 200, f"Expected 200 from edge proxy, got {resp.status_code}: {resp.data}"
    assert "document_id" in resp.data
    assert "extraction_id" in resp.data


def test_03_edge_proxy_missing_auth_rejected(client: CawrysClient, valid_drawing_content: str):
    resp = client.edge_ingest_file(
        filename="unauth_dwg.txt",
        content=valid_drawing_content,
        token=None,
    )
    assert resp.status_code == 401, f"Expected 401 Unauthorized, got {resp.status_code}"


def test_04_edge_sensor_event_valid_key(client: CawrysClient):
    payload = {
        "sensor_id": "CNC-MILL-01",
        "temperature_c": 42.5,
        "vibration_rms": 0.012,
        "status": "nominal",
    }
    resp = client.edge_ingest_event(payload)
    assert resp.status_code == 202, f"Expected 202 Accepted, got {resp.status_code}: {resp.data}"
    assert resp.data.get("accepted") is True


def test_05_edge_sensor_event_invalid_key(client: CawrysClient):
    payload = {"sensor_id": "CNC-MILL-01", "status": "nominal"}
    resp = client.edge_ingest_event(payload, api_key="invalid_edge_key_xyz")
    assert resp.status_code == 401, f"Expected 401 Unauthorized, got {resp.status_code}"


def test_06_edge_sensor_event_malformed_json(client: CawrysClient):
    # Send malformed string directly
    url = f"{client.edge_url}/ingest/event"
    headers = {"Content-Type": "application/json", "X-API-Key": client.edge_api_key}
    resp = client._http_request(url, method="POST", headers=headers, data="{not_valid_json:")
    assert resp.status_code == 400, f"Expected 400 Bad Request, got {resp.status_code}"
