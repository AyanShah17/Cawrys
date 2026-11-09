"""Tier 1: Feature Coverage — Operational Reasoning Engine."""
import pytest
from tests.e2e.client import CawrysClient


def test_01_valid_drawing_proposes_playbook(client: CawrysClient, engineer_token: str):
    content = "Drawing ID: DWG-1042\nMaterial: Aluminum 6061\nQuantity: 25\nTolerance: 0.05\n"
    resp = client.upload_document(filename="dwg_reason.txt", content=content, token=engineer_token)
    assert resp.status_code == 200
    decision = resp.data.get("decision", {})
    proposed_actions = decision.get("proposed_actions", [])
    assert len(proposed_actions) >= 1
    action = proposed_actions[0]
    assert action.get("action") == "run_playbook:production-setup"
    assert action.get("risk") == "medium"


def test_02_validation_issues_generate_open_questions(client: CawrysClient, engineer_token: str):
    content = "Drawing ID: DWG-incomplete\nMaterial: Copper\n"
    resp = client.upload_document(filename="dwg_questions.txt", content=content, token=engineer_token)
    assert resp.status_code == 200
    decision = resp.data.get("decision", {})
    open_questions = decision.get("open_questions", [])
    assert len(open_questions) >= 1
    assert any("missing_fields" in q for q in open_questions)


def test_03_reasoning_summary_synthesis(client: CawrysClient, engineer_token: str):
    content = "Drawing ID: DWG-100\nMaterial: Iron\nQuantity: 10\n"
    resp = client.upload_document(filename="dwg_summary.txt", content=content, token=engineer_token)
    assert resp.status_code == 200
    decision = resp.data.get("decision", {})
    summary = decision.get("summary", "")
    assert "technical_drawing" in summary
    assert "3 extracted fields" in summary


def test_04_clean_document_status_ready(client: CawrysClient, engineer_token: str):
    content = "Drawing ID: DWG-200\nMaterial: Brass\nQuantity: 40\n"
    resp = client.upload_document(filename="dwg_ready.txt", content=content, token=engineer_token)
    assert resp.status_code == 200
    assert resp.data.get("status") == "ready"


def test_05_flagged_document_status_needs_review(client: CawrysClient, engineer_token: str):
    content = "Drawing ID: DWG-300\nMaterial: Bronze\n"
    resp = client.upload_document(filename="dwg_review.txt", content=content, token=engineer_token)
    assert resp.status_code == 200
    assert resp.data.get("status") == "needs_review"
