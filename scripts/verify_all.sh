#!/usr/bin/env bash
# scripts/verify_all.sh - Cawrys Unified Monorepo Verification Harness
# Runs static analysis & builds, automated E2E test suites, and live stack smoke tests.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Determine Python binary: prioritize repo virtualenv
if [ -x "$REPO_ROOT/.venv/bin/python3" ]; then
    PYTHON="$REPO_ROOT/.venv/bin/python3"
elif [ -x "$REPO_ROOT/.venv/bin/python" ]; then
    PYTHON="$REPO_ROOT/.venv/bin/python"
else
    PYTHON="python3"
fi

PORT_INTEL=${PORT_INTEL:-8001}
PORT_EXEC=${PORT_EXEC:-8002}
SQLITE_DB="/tmp/cawrys_verify_$$.db"

cleanup() {
    local ec=$?
    if [ -n "${P_INTEL:-}" ]; then
        kill "$P_INTEL" 2>/dev/null || true
        wait "$P_INTEL" 2>/dev/null || true
    fi
    if [ -n "${P_EXEC:-}" ]; then
        kill "$P_EXEC" 2>/dev/null || true
        wait "$P_EXEC" 2>/dev/null || true
    fi
    rm -f "${SQLITE_DB}"* /tmp/cawrys_drawing.txt /tmp/cawrys_incomplete.txt
    exit "$ec"
}
trap cleanup EXIT INT TERM

run_static() {
    echo "========================================="
    echo "=== [1/3] Static Analysis & Builds ==="
    echo "========================================="

    echo "--> [Web App] TypeScript check & production build..."
    (cd apps/web && npm run typecheck && npm run build)

    echo "--> [Go Edge-Ingest] Go vet & compilation..."
    (cd services/edge-ingest && go vet ./... && go build -v -o /dev/null .)

    echo "--> [Python Services] Source compilation & syntax check..."
    "$PYTHON" -m py_compile services/intelligence/app/*.py services/execution/app/*.py

    echo "Static checks and builds passed successfully."
}

run_tests() {
    echo "========================================="
    echo "=== [2/3] Automated E2E & Stress Tests ==="
    echo "========================================="

    echo "--> [E2E Suite] Running 4-tier E2E tests..."
    PYTHONPATH=. "$PYTHON" tests/e2e/runner.py --tier all

    echo "--> [SQLite Stress] Running multi-process stress harness..."
    PYTHONPATH=. "$PYTHON" tests/test_sqlite_stress.py

    echo "Automated tests passed successfully."
}

run_smoke() {
    echo "========================================="
    echo "=== [3/3] Live Stack Smoke Test ==="
    echo "========================================="

    export MOCK_AI=1
    export NEON_DATABASE_URL=""
    export SEED_DEMO=1
    export DEMO_PASSWORD=cawrys-demo
    export SQLITE_PATH="$SQLITE_DB"
    export AUTH_SECRET="0123456789012345678901234567890123456789012345678901234567890123"
    export INTELLIGENCE_URL="http://127.0.0.1:$PORT_INTEL"
    export EXECUTION_URL="http://127.0.0.1:$PORT_EXEC"

    echo "--> Spawning background Intelligence service on :$PORT_INTEL..."
    "$PYTHON" -m uvicorn services.intelligence.app.main:app --host 127.0.0.1 --port "$PORT_INTEL" --log-level warning &
    P_INTEL=$!

    echo "--> Spawning background Execution service on :$PORT_EXEC..."
    "$PYTHON" -m uvicorn services.execution.app.main:app --host 127.0.0.1 --port "$PORT_EXEC" --log-level warning &
    P_EXEC=$!

    echo "--> Waiting for services to become healthy..."
    READY=0
    for i in $(seq 1 50); do
        if curl -s -f "http://127.0.0.1:$PORT_INTEL/health" > /dev/null 2>&1 && \
           curl -s -f "http://127.0.0.1:$PORT_EXEC/health" > /dev/null 2>&1; then
            READY=1
            break
        fi
        sleep 0.2
    done

    if [ "$READY" -ne 1 ]; then
        echo "ERROR: Backend services failed to start within 10 seconds." >&2
        exit 1
    fi

    echo "--> Services healthy. Executing scripts/smoke_test.sh..."
    bash scripts/smoke_test.sh

    echo "--> Stopping background services..."
    kill "$P_INTEL" "$P_EXEC" 2>/dev/null || true
    wait "$P_INTEL" 2>/dev/null || true
    wait "$P_EXEC" 2>/dev/null || true
    unset P_INTEL P_EXEC

    echo "Live stack smoke test passed successfully."
}

MODE="${1:-all}"
case "$MODE" in
    static)
        run_static
        ;;
    test)
        run_tests
        ;;
    smoke)
        run_smoke
        ;;
    all)
        run_static
        run_tests
        run_smoke
        echo "========================================="
        echo "  ALL VERIFICATION CHECKS PASSED (M4)"
        echo "========================================="
        ;;
    *)
        echo "Usage: $0 [all|static|test|smoke]"
        exit 1
        ;;
esac
