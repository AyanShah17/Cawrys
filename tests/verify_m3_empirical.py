#!/usr/bin/env python3
"""Empirical verification harness for Milestone M3 Challenge.

1. Starts live services/intelligence (8001) and services/execution (8002) with:
   - NEON_DATABASE_URL=""
   - MOCK_AI=1
   - SQLITE_PATH=/tmp/cawrys_challenge_m3_2.db
2. Runs scripts/smoke_test.sh and verifies all 22 checks pass.
3. Queries /tmp/cawrys_challenge_m3_2.db to verify persistence of documents,
   extractions, executions, and audit logs.
4. Auto-fallback stress test: starts intelligence service with GEMINI_API_KEY=""
   and MOCK_AI unset, uploads a document, and asserts mock traces are generated.
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
import urllib.error

DB_PATH = "/tmp/cawrys_challenge_m3_2.db"
AUTOMOCK_DB_PATH = "/tmp/cawrys_automock_m3_2.db"
PYTHON_BIN = os.path.abspath(".venv/bin/python3") if os.path.exists(".venv/bin/python3") else sys.executable

def cleanup_db(path):
    for f in [path, f"{path}-wal", f"{path}-shm", f"{path}-journal"]:
        if os.path.exists(f):
            try:
                os.remove(f)
            except OSError:
                pass

def wait_for_service(url, timeout=10.0):
    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(f"{url}/health", timeout=1.0) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.2)
    return False

def run_task1():
    print("=" * 70)
    print("TASK 1: Live Services Execution + SQLite Fallback + Smoke Test")
    print("=" * 70)
    cleanup_db(DB_PATH)

    env = os.environ.copy()
    env["PYTHONPATH"] = "."
    env["NEON_DATABASE_URL"] = ""
    env["DATABASE_URL"] = ""
    env["MOCK_AI"] = "1"
    env["SEED_DEMO"] = "1"
    env["DEMO_PASSWORD"] = "cawrys-demo"
    env["SQLITE_PATH"] = DB_PATH
    env["STORAGE_DIR"] = "/tmp/cawrys_files_challenge"
    env["INTELLIGENCE_URL"] = "http://127.0.0.1:8001"
    env["EXECUTION_URL"] = "http://127.0.0.1:8002"

    p1 = subprocess.Popen(
        [PYTHON_BIN, "-m", "uvicorn", "services.intelligence.app.main:app", "--host", "127.0.0.1", "--port", "8001"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    p2 = subprocess.Popen(
        [PYTHON_BIN, "-m", "uvicorn", "services.execution.app.main:app", "--host", "127.0.0.1", "--port", "8002"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    try:
        print("[1.1] Waiting for Intelligence (8001) and Execution (8002) to become healthy...")
        ok1 = wait_for_service("http://127.0.0.1:8001")
        ok2 = wait_for_service("http://127.0.0.1:8002")
        if not ok1 or not ok2:
            time.sleep(0.5)
            p1.poll()
            p2.poll()
            out1, err1 = p1.communicate(timeout=2) if p1.poll() is not None else ("", "p1 still running or socket error")
            out2, err2 = p2.communicate(timeout=2) if p2.poll() is not None else ("", "p2 still running or socket error")
            print(f"p1 returncode: {p1.returncode}, stdout: {out1}, stderr: {err1}")
            print(f"p2 returncode: {p2.returncode}, stdout: {out2}, stderr: {err2}")
            if not ok1:
                raise RuntimeError("Intelligence service failed to become healthy on port 8001")
            if not ok2:
                raise RuntimeError("Execution service failed to become healthy on port 8002")
        print("[1.1] Both services healthy.")

        print("[1.2] Executing scripts/smoke_test.sh...")
        smoke_proc = subprocess.run(
            ["bash", "scripts/smoke_test.sh"],
            env=env,
            capture_output=True,
            text=True,
        )
        print("--- smoke_test.sh stdout ---")
        print(smoke_proc.stdout.strip())
        if smoke_proc.stderr:
            print("--- smoke_test.sh stderr ---")
            print(smoke_proc.stderr.strip())

        smoke_lines = [line for line in smoke_proc.stdout.splitlines() if line.startswith("ok   ")]
        print(f"\n[1.3] Verified passed check count: {len(smoke_lines)} / 22")
        assert len(smoke_lines) == 22, f"Expected 22 ok checks, found {len(smoke_lines)}"
        assert "ALL CHECKS PASSED" in smoke_proc.stdout, "ALL CHECKS PASSED not in smoke test output"
        assert smoke_proc.returncode == 0, f"Smoke test exited with code {smoke_proc.returncode}"
        print("[1.3] Smoke test exit code: 0 - ALL 22 CHECKS CONFIRMED PASSED.")

        print("\n[1.4] Inspecting SQLite database persistence at:", DB_PATH)
        assert os.path.exists(DB_PATH), f"Database file {DB_PATH} was not created!"
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # Check documents
        docs = cur.execute("SELECT id, filename, status, mime_type FROM documents ORDER BY created_at ASC").fetchall()
        print(f"  - Documents count: {len(docs)}")
        for d in docs:
            print(f"    * doc_id={d['id']}, file={d['filename']}, status={d['status']}")
        assert len(docs) >= 2, f"Expected at least 2 documents, got {len(docs)}"

        # Check extractions
        exts = cur.execute("SELECT id, document_id, doc_type, fields, confidence, validation, decision, model_trace FROM extractions").fetchall()
        print(f"  - Extractions count: {len(exts)}")
        for e in exts:
            print(f"    * ext_id={e['id']}, doc_type={e['doc_type']}, confidence={e['confidence']}, model_trace={e['model_trace']}")
        assert len(exts) >= 2, f"Expected at least 2 extractions, got {len(exts)}"

        # Check executions
        executions = cur.execute("SELECT id, playbook_id, status, result FROM executions").fetchall()
        print(f"  - Executions count: {len(executions)}")
        for ex in executions:
            print(f"    * exec_id={ex['id']}, status={ex['status']}")
        assert len(executions) >= 2, f"Expected at least 2 executions, got {len(executions)}"
        exec_statuses = [ex['status'] for ex in executions]
        assert "succeeded" in exec_statuses, "No succeeded execution found"
        assert "rejected" in exec_statuses, "No rejected execution found"

        # Check audit_log
        audit_records = cur.execute("SELECT service, actor, event, workflow_id FROM audit_log ORDER BY id ASC").fetchall()
        print(f"  - Audit log entries count: {len(audit_records)}")
        services = set(r["service"] for r in audit_records)
        print(f"    * Services in audit_log: {services}")
        assert "intelligence" in services, "No intelligence events in audit_log"
        assert "execution" in services, "No execution events in audit_log"

        approver_events = [r for r in audit_records if r["actor"] == "approver@cawrys.local"]
        print(f"    * Approver actor events count: {len(approver_events)}")
        assert len(approver_events) > 0, "No approver@cawrys.local actor events in audit_log"

        conn.close()
        print("[1.5] SQLite persistence verification: 100% SUCCESSFUL.\n")

    finally:
        p1.terminate()
        p2.terminate()
        p1.wait()
        p2.wait()
        cleanup_db(DB_PATH)


def run_task2():
    print("=" * 70)
    print("TASK 2: AI Mock Auto-Fallback Stress Test (GEMINI_API_KEY='' & MOCK_AI unset)")
    print("=" * 70)
    cleanup_db(AUTOMOCK_DB_PATH)

    env = os.environ.copy()
    env["PYTHONPATH"] = "."
    env["NEON_DATABASE_URL"] = ""
    env["DATABASE_URL"] = ""
    env["GEMINI_API_KEY"] = ""
    if "MOCK_AI" in env:
        del env["MOCK_AI"]
    env["SEED_DEMO"] = "1"
    env["DEMO_PASSWORD"] = "cawrys-demo"
    env["SQLITE_PATH"] = AUTOMOCK_DB_PATH
    env["STORAGE_DIR"] = "/tmp/cawrys_files_automock"
    env["INTELLIGENCE_URL"] = "http://127.0.0.1:8001"

    p = subprocess.Popen(
        [PYTHON_BIN, "-m", "uvicorn", "services.intelligence.app.main:app", "--host", "127.0.0.1", "--port", "8001"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    try:
        print("[2.1] Waiting for Intelligence service on port 8001...")
        if not wait_for_service("http://127.0.0.1:8001"):
            raise RuntimeError("Intelligence service failed to become healthy on port 8001 in auto-fallback mode")
        print("[2.1] Service operational.")

        print("[2.2] Obtaining engineer token...")
        login_req = urllib.request.Request(
            "http://127.0.0.1:8001/v1/auth/login",
            data=json.dumps({"email": "engineer@cawrys.local", "password": "cawrys-demo"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(login_req) as resp:
            login_data = json.loads(resp.read().decode("utf-8"))
            token = login_data["token"]
        assert token, "Failed to get auth token"
        print("[2.2] Authenticated as engineer.")

        print("[2.3] Uploading document to trigger extraction and reasoning...")
        boundary = "----CawrysAutomockBoundaryXYZ"
        body_str = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="spec_auto.txt"\r\n'
            f"Content-Type: text/plain\r\n\r\n"
            f"Drawing ID: DWG-AUTOMOCK-99\nMaterial: Titanium Gr5\nQuantity: 15\nTolerance: 0.01\n\r\n"
            f"--{boundary}--\r\n"
        )
        up_req = urllib.request.Request(
            "http://127.0.0.1:8001/v1/documents",
            data=body_str.encode("utf-8"),
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Authorization": f"Bearer {token}",
            },
            method="POST",
        )
        with urllib.request.urlopen(up_req) as resp:
            up_data = json.loads(resp.read().decode("utf-8"))
        print("[2.3] Upload response:", json.dumps(up_data, indent=2))
        assert up_data["status"] == "ready", f"Expected ready, got {up_data['status']}"
        assert up_data["fields"]["drawing_id"] == "DWG-AUTOMOCK-99"
        assert up_data["fields"]["material"] == "Titanium Gr5"
        assert up_data["fields"]["quantity"] == 15

        print("[2.4] Querying SQLite extractions table for model_trace...")
        conn = sqlite3.connect(AUTOMOCK_DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        ext = cur.execute("SELECT doc_type, fields, model_trace FROM extractions WHERE document_id=?", (up_data["document_id"],)).fetchone()
        assert ext is not None, "Extraction row not found in SQLite DB"
        print(f"  - Extracted doc_type: {ext['doc_type']}")
        print(f"  - Raw model_trace: {ext['model_trace']}")
        traces = json.loads(ext["model_trace"]) if isinstance(ext["model_trace"], str) else ext["model_trace"]
        assert isinstance(traces, list), "model_trace must be a list"
        assert len(traces) == 2, f"Expected 2 traces (extract + reason), got {len(traces)}"
        assert traces[0]["model"] == "mock:cawrys-extract"
        assert traces[0]["tokens"] == 0
        assert traces[1]["model"] == "mock:cawrys-reason"
        assert traces[1]["tokens"] == 0
        conn.close()
        print("[2.5] Auto-mock fallback stress test: 100% SUCCESSFUL (mock models verified in trace).")

    finally:
        p.terminate()
        p.wait()
        cleanup_db(AUTOMOCK_DB_PATH)


if __name__ == "__main__":
    run_task1()
    run_task2()
    print("\n" + "=" * 70)
    print("ALL EMPIRICAL TESTS PASSED SUCCESSFULLY!")
    print("=" * 70)
