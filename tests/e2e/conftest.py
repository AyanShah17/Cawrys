"""Pytest fixtures for Cawrys E2E Test Suite."""
import os
import time
import urllib.request
import pytest

from tests.e2e.client import CawrysClient, make_custom_token
from tests.e2e.mock_server import MockServerManager

_mock_manager = None


def is_service_up(url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/health", timeout=1) as resp:
            return resp.status == 200
    except Exception:
        return False


@pytest.fixture(scope="session", autouse=True)
def ensure_services():
    global _mock_manager
    intel_url = os.environ.get("INTELLIGENCE_URL", "http://localhost:8001")
    exec_url = os.environ.get("EXECUTION_URL", "http://localhost:8002")
    edge_url = os.environ.get("EDGE_INGEST_URL", "http://localhost:8080")

    if not (is_service_up(intel_url) and is_service_up(exec_url) and is_service_up(edge_url)):
        _mock_manager = MockServerManager()
        _mock_manager.start()
        time.sleep(0.5)

    yield

    if _mock_manager:
        _mock_manager.stop()


@pytest.fixture(scope="session")
def client() -> CawrysClient:
    return CawrysClient()


@pytest.fixture(scope="session")
def admin_token(client: CawrysClient) -> str:
    return client.get_token("admin")


@pytest.fixture(scope="session")
def engineer_token(client: CawrysClient) -> str:
    return client.get_token("engineer")


@pytest.fixture(scope="session")
def approver_token(client: CawrysClient) -> str:
    return client.get_token("approver")


@pytest.fixture(scope="session")
def viewer_token(client: CawrysClient) -> str:
    return client.get_token("viewer")


@pytest.fixture
def valid_drawing_content() -> str:
    return "Drawing ID: DWG-1042\nMaterial: Aluminum 6061\nQuantity: 25\nTolerance: 0.05\n"


@pytest.fixture
def incomplete_drawing_content() -> str:
    return "Drawing ID: DWG-9\nMaterial: Steel\n"

