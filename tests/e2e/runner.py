#!/usr/bin/env python3
"""Cawrys Unified E2E Test Suite Runner.

Discovers and runs the 4-tier E2E test suite. Automatically manages offline mock
services when live backend services are not running.
"""
import argparse
import os
import sys
import time
import urllib.request
import pytest

from tests.e2e.mock_server import MockServerManager


def check_service(url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/health", timeout=1) as resp:
            return resp.status == 200
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser(description="Run Cawrys 4-Tier E2E Test Suite")
    parser.add_argument("--tier", choices=["1", "2", "3", "4", "all"], default="all", help="Test tier to execute")
    parser.add_argument("--offline", action="store_true", help="Force offline mock servers")
    parser.add_argument("-v", "--verbose", action="store_true", default=True, help="Verbose output")
    parser.add_argument("-k", "--expression", help="Filter tests by keyword expression")
    args = parser.parse_args()

    intel_url = os.environ.get("INTELLIGENCE_URL", "http://localhost:8001")
    exec_url = os.environ.get("EXECUTION_URL", "http://localhost:8002")
    edge_url = os.environ.get("EDGE_INGEST_URL", "http://localhost:8080")

    live_running = check_service(intel_url) and check_service(exec_url) and check_service(edge_url)
    mock_manager = None

    if args.offline or not live_running:
        print("[INFO] Services not running or --offline specified. Starting self-contained mock runtime...")
        mock_manager = MockServerManager()
        mock_manager.start()
        time.sleep(0.5)
        print("[INFO] Mock runtime operational on ports 8001, 8002, 8080, 3000.")
    else:
        print(f"[INFO] Running against live Cawrys services ({intel_url}, {exec_url}, {edge_url}).")

    test_dirs = []
    base_dir = os.path.dirname(os.path.abspath(__file__))

    tier_map = {
        "1": ["tier1_feature"],
        "2": ["tier2_boundary"],
        "3": ["tier3_combination"],
        "4": ["tier4_scenarios"],
        "all": ["tier1_feature", "tier2_boundary", "tier3_combination", "tier4_scenarios"],
    }

    for t in tier_map[args.tier]:
        test_dirs.append(os.path.join(base_dir, t))

    pytest_args = ["-q", "--no-header"]
    if args.verbose:
        pytest_args = ["-v"]
    if args.expression:
        pytest_args.extend(["-k", args.expression])

    pytest_args.extend(test_dirs)

    start_time = time.time()
    try:
        ret = pytest.main(pytest_args)
    finally:
        if mock_manager:
            mock_manager.stop()
            print("[INFO] Mock runtime shut down cleanly.")

    duration = time.time() - start_time
    print(f"\n[INFO] Suite finished in {duration:.2f}s with exit code {ret}.")
    sys.exit(int(ret))


if __name__ == "__main__":
    main()
