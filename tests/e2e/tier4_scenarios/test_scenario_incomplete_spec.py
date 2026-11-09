"""Tier 4: Real-World Scenario — Emergency Part Shortage & Incomplete Spec Handling."""
import pytest
from tests.e2e.client import CawrysClient


def test_01_incomplete_order_fax_workflow(client: CawrysClient, engineer_token: str):
    # Factory receives an emergency order fax with missing quantity
    fax_content = (
        "--- EMERGENCY PRODUCTION ORDER ---\n"
        "Drawing ID: DWG-RUSH-404\n"
        "Material: Steel 4140\n"
        "Delivery Date: ASAP\n"
    )
    resp = client.edge_ingest_file("rush_order.txt", fax_content, token=engineer_token)
    assert resp.status_code == 200

    # Validation must flag needs_review because 'quantity' is missing
    assert resp.data["status"] == "needs_review"
    validation = resp.data.get("validation", {})
    assert validation["needs_review"] is True
    assert any(i.get("type") == "missing_fields" for i in validation.get("issues", []))

    # Reasoning engine should generate open questions rather than automated playbooks
    decision = resp.data.get("decision", {})
    open_questions = decision.get("open_questions", [])
    assert len(open_questions) > 0
    assert any("missing_fields" in q for q in open_questions)


def test_02_negative_dimension_safety_hold(client: CawrysClient, engineer_token: str):
    # Blueprint upload containing negative physical dimensions (e.g. data entry error)
    content = "Drawing ID: DWG-ERR-1\nMaterial: Inconel\nQuantity: -10\n"
    resp = client.upload_document("err_dwg.txt", content, token=engineer_token)
    assert resp.status_code == 200
    assert resp.data["status"] == "needs_review"

    validation = resp.data.get("validation", {})
    assert any(i.get("type") == "negative_value" for i in validation.get("issues", []))
