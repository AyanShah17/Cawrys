#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

export MOCK_AI="${MOCK_AI:-1}"
export SEED_DEMO="${SEED_DEMO:-1}"
export DEMO_PASSWORD="${DEMO_PASSWORD:-cawrys-demo}"
export SQLITE_PATH="${SQLITE_PATH:-$REPO_ROOT/data/cawrys.db}"
export INTELLIGENCE_URL="${INTELLIGENCE_URL:-http://127.0.0.1:8001}"
export EXECUTION_URL="${EXECUTION_URL:-http://127.0.0.1:8002}"

mkdir -p "$REPO_ROOT/data"

PYTHON="$REPO_ROOT/.venv/bin/python3"

cleanup() {
  kill "${P_INTEL:-}" "${P_EXEC:-}" "${P_WEB:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting Intelligence service on http://127.0.0.1:8001 ..."
"$PYTHON" -m uvicorn services.intelligence.app.main:app --host 127.0.0.1 --port 8001 &
P_INTEL=$!

echo "Starting Execution service on http://127.0.0.1:8002 ..."
"$PYTHON" -m uvicorn services.execution.app.main:app --host 127.0.0.1 --port 8002 &
P_EXEC=$!

echo "Starting Next.js Web UI on http://localhost:3000 ..."
(cd apps/web && npm run start -- -p 3000) &
P_WEB=$!

wait
