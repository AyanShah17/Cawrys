#!/usr/bin/env bash
# Runner script for Cawrys 4-Tier E2E Test Suite
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

export PYTHONPATH="$WORKSPACE_ROOT:${PYTHONPATH:-}"

echo "=========================================================="
echo " Starting Cawrys 4-Tier E2E Test Suite"
echo " Workspace: $WORKSPACE_ROOT"
echo "=========================================================="

python3 "$SCRIPT_DIR/runner.py" "$@"
