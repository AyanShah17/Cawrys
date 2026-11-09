#!/usr/bin/env bash
# End-to-end check against running services: login, roles, tenant isolation, upload, playbook, approval.
# Uses the demo accounts, so run it with SEED_DEMO=1 and the default DEMO_PASSWORD (or export DEMO_PASSWORD).
set -uo pipefail +B
INTEL=${INTELLIGENCE_URL:-http://localhost:8001}
EXEC=${EXECUTION_URL:-http://localhost:8002}
PW=${DEMO_PASSWORD:-cawrys-demo}
J='Content-Type: application/json'
FAIL=0
jget() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (expected $3, got $2)"; FAIL=1; fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
login() { curl -fsS -X POST "$INTEL/v1/auth/login" -H "$J" -d "{\"email\":\"$1@cawrys.local\",\"password\":\"$PW\"}" | jget "['token']"; }

ENG=$(login engineer); APP=$(login approver); VIEW=$(login viewer); ADM=$(login admin)
A() { echo "Authorization: Bearer ${1:-}"; }

check "login with wrong password rejected" "$(code -X POST $INTEL/v1/auth/login -H "$J" -d '{"email":"admin@cawrys.local","password":"nope"}')" 401
check "no token rejected (intelligence)" "$(code $INTEL/v1/documents)" 401
check "no token rejected (execution)" "$(code $EXEC/v1/executions)" 401
check "garbage token rejected" "$(code $INTEL/v1/documents -H 'Authorization: Bearer abc.def.ghi')" 401
check "signup disabled by default" "$(code -X POST $INTEL/v1/auth/signup -H "$J" -d '{"company":"X Corp","email":"x@x.com","password":"longenough1"}')" 403

printf 'Drawing ID: DWG-1042\nMaterial: Aluminum 6061\nQuantity: 25\nTolerance: 0.05\n' > /tmp/cawrys_drawing.txt
printf 'Drawing ID: DWG-9\nMaterial: Steel\n' > /tmp/cawrys_incomplete.txt

check "viewer cannot upload" "$(code -F file=@/tmp/cawrys_drawing.txt $INTEL/v1/documents -H "$(A $VIEW)")" 403
UP=$(curl -fsS -F file=@/tmp/cawrys_drawing.txt $INTEL/v1/documents -H "$(A $ENG)")
check "engineer upload processed" "$(echo "$UP" | jget "['status']")" ready
EXT=$(echo "$UP" | jget "['extraction_id']"); DOC=$(echo "$UP" | jget "['document_id']")
check "viewer can read documents" "$(code $INTEL/v1/documents/$DOC -H "$(A $VIEW)")" 200

BAD=$(curl -fsS -F file=@/tmp/cawrys_incomplete.txt $INTEL/v1/documents -H "$(A $ENG)")
check "incomplete document flagged for review" "$(echo "$BAD" | jget "['status']")" needs_review

RUN=$(curl -fsS -X POST $EXEC/v1/executions -H "$J" -H "$(A $ENG)" -d "{\"playbook\":\"production-setup\",\"extraction_id\":\"$EXT\"}")
XID=$(echo "$RUN" | jget "['execution_id']")
check "run waits for approval" "$(echo "$RUN" | jget "['status']")" awaiting_approval
check "viewer run is rejected by policy" "$(curl -fsS -X POST $EXEC/v1/executions -H "$J" -H "$(A $VIEW)" -d "{\"playbook\":\"production-setup\",\"extraction_id\":\"$EXT\"}" | jget "['status']")" rejected
check "engineer cannot approve" "$(code -X POST $EXEC/v1/executions/$XID/approve -H "$(A $ENG)")" 403
check "viewer cannot approve" "$(code -X POST $EXEC/v1/executions/$XID/approve -H "$(A $VIEW)")" 403
OK=$(curl -fsS -X POST $EXEC/v1/executions/$XID/approve -H "$(A $APP)")
check "approver completes the run" "$(echo "$OK" | jget "['status']")" succeeded
check "all 3 steps recorded once" "$(echo "$OK" | jget "['results'].__len__()")" 3
check "double approval blocked" "$(code -X POST $EXEC/v1/executions/$XID/approve -H "$(A $APP)")" 409

X2=$(curl -fsS -X POST $EXEC/v1/executions -H "$J" -H "$(A $ENG)" -d "{\"playbook\":\"production-setup\",\"extraction_id\":\"$EXT\"}" | jget "['execution_id']")
check "approver can reject" "$(curl -fsS -X POST $EXEC/v1/executions/$X2/reject -H "$(A $APP)" | jget "['status']")" rejected

# ---- admin: user management and tenant isolation ----
check "non-admin cannot list users" "$(code $INTEL/v1/auth/users -H "$(A $ENG)")" 403
check "admin lists users" "$(curl -fsS $INTEL/v1/auth/users -H "$(A $ADM)" | jget ".__len__()")" 4
EMAIL="other$RANDOM@other.example"
curl -s -o /dev/null -X POST $INTEL/v1/auth/users -H "$J" -H "$(A $ADM)" -d "{\"email\":\"$EMAIL\",\"password\":\"short\",\"role\":\"viewer\"}"
check "short password refused" "$(code -X POST $INTEL/v1/auth/users -H "$J" -H "$(A $ADM)" -d "{\"email\":\"$EMAIL\",\"password\":\"short\",\"role\":\"viewer\"}")" 422
check "unknown role refused" "$(code -X POST $INTEL/v1/auth/users -H "$J" -H "$(A $ADM)" -d "{\"email\":\"$EMAIL\",\"password\":\"longenough1\",\"role\":\"god\"}")" 400

if [ -n "${OTHER_TENANT_TOKEN:-}" ]; then
  check "other tenant cannot read our document" "$(code $INTEL/v1/documents/$DOC -H "$(A $OTHER_TENANT_TOKEN)")" 404
  check "other tenant sees no executions" "$(curl -fsS $EXEC/v1/executions -H "$(A $OTHER_TENANT_TOKEN)" | jget ".__len__()")" 0
fi

# ---- audit names real people ----
check "audit records approver email" "$(curl -fsS "$INTEL/v1/audit?limit=200" -H "$(A $ADM)" | python3 -c "import sys,json;print(any(r['actor']=='approver@cawrys.local' and r['event'].startswith('execution.approved') for r in json.load(sys.stdin)))")" True

[ $FAIL = 0 ] && echo "ALL CHECKS PASSED" || { echo "SOME CHECKS FAILED"; exit 1; }
