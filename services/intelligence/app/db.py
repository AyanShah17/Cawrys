import json
from contextlib import contextmanager

from .sqlite_adapter import get_connection


@contextmanager
def conn():
    c = get_connection()
    with c:
        yield c


def audit(c, tenant_id, event, workflow_id=None, detail=None, actor="system"):
    c.execute(
        "insert into audit_log (tenant_id, actor, service, event, workflow_id, detail) "
        "values (%s,%s,'intelligence',%s,%s,%s)",
        (tenant_id, actor, event, workflow_id, json.dumps(detail or {})),
    )
