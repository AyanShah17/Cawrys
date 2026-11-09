#!/usr/bin/env bash
# Creates .env from .env.example with freshly generated secrets. Safe to re-run: it never overwrites an existing .env.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then echo ".env already exists, leaving it alone"; exit 0; fi
cp .env.example .env
python3 -c '
import re, secrets
with open(".env", "r") as f:
    c = f.read()
c = re.sub(r"^AUTH_SECRET=.*", f"AUTH_SECRET={secrets.token_hex(32)}", c, flags=re.MULTILINE)
c = re.sub(r"^EDGE_API_KEY=.*", f"EDGE_API_KEY={secrets.token_hex(32)}", c, flags=re.MULTILINE)
with open(".env", "w") as f:
    f.write(c)
'
echo "Created .env with generated AUTH_SECRET and EDGE_API_KEY."
echo "Demo logins: admin|engineer|approver|viewer@cawrys.local, password: cawrys-demo (change DEMO_PASSWORD before real use)"
