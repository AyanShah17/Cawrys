"""Tier 1: Feature Coverage — Document Extraction & Deterministic Validation."""
import pytest
from tests.e2e.client import CawrysClient


def test_01_complete_drawing_extraction(client: CawrysClient, engineer_token: str):
    content = "Drawing ID: DWG-1042\nMaterial: Aluminum 6061\nQuantity: 25\nTolerance: 0.05\n"
    resp = client.upload_document(filename="dwg_complete.txt", content=content, token=engineer_token)
    assert resp.status_code == 200
    fields = resp.data.get("fields", {})
    assert fields.get("drawing_id") == "DWG-1042"
    assert fields.get("material") == "Aluminum 6061"
    assert fields.get("quantity") == 25
    assert resp.data.get("doc_type") == "technical_drawing"


def test_02_general_document_extraction(client: CawrysClient, engineer_token: str):
    content = "Invoice Number: INV-9901\nVendor: Acme Corp\nTotal: 1500\n"
    resp = client.upload_document(filename="invoice.txt", content=content, token=engineer_token)
    assert resp.status_code == 200
    fields = resp.data.get("fields", {})
    assert fields.get("invoice_number") == "INV-9901"
    assert fields.get("vendor") == "Acme Corp"
    assert resp.data.get("doc_type") == "document"


def test_03_numeric_field_coercion(client: CawrysClient, engineer_token: str):
    content = "Drawing ID: DWG-500\nMaterial: Steel\nQuantity: 100\nTolerance: 0.005\n"
    resp = client.upload_document(filename="dwg_coercion.txt", content=content, token=engineer_token)
    assert resp.status_code == 200
    fields = resp.data.get("fields", {})
    assert isinstance(fields.get("quantity"), int)
    assert isinstance(fields.get("tolerance"), float)
    assert fields.get("quantity") == 100
    assert fields.get("tolerance") == 0.005


def test_04_missing_required_drawing_fields(client: CawrysClient, engineer_token: str):
    # Technical drawing missing Quantity
    content = "Drawing ID: DWG-999\nMaterial: Titanium\n"
    resp = client.upload_document(filename="dwg_incomplete.txt", content=content, token=engineer_token)
    assert resp.status_code == 200
    validation = resp.data.get("validation", {})
    issues = validation.get("issues", [])
    assert any(i.get("type") == "missing_fields" for i in issues)
    missing_issue = next(i for i in issues if i.get("type") == "missing_fields")
    assert "quantity" in missing_issue.get("fields", [])


def test_05_negative_dimensions_flagged(client: CawrysClient, engineer_token: str):
    content = "Drawing ID: DWG-777\nMaterial: Brass\nQuantity: -50\n"
    resp = client.upload_document(filename="dwg_negative.txt", content=content, token=engineer_token)
    assert resp.status_code == 200
    validation = resp.data.get("validation", {})
    issues = validation.get("issues", [])
    assert any(i.get("type") == "negative_value" for i in issues)
    neg_issue = next(i for i in issues if i.get("type") == "negative_value")
    assert neg_issue.get("field") == "quantity"
    assert neg_issue.get("value") == -50


def test_06_overall_confidence_score(client: CawrysClient, engineer_token: str):
    content = "Drawing ID: DWG-1042\nMaterial: Aluminum 6061\nQuantity: 25\nTolerance: 0.05\n"
    resp = client.upload_document(filename="dwg_conf.txt", content=content, token=engineer_token)
    assert resp.status_code == 200
    validation = resp.data.get("validation", {})
    assert "overall_confidence" in validation
    assert validation["overall_confidence"] >= 0.8
    assert validation["passed"] is True
