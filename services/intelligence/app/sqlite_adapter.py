"""SQLite fallback adapter for offline execution when PostgreSQL credentials are absent.

Provides PostgreSQL query translation, JSON deserialization, and shared multi-process
database access with WAL mode and busy timeout handling.
"""
import json
import os
import re
import sqlite3
import uuid
from pathlib import Path

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','engineer','approver','viewer')),
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  ok INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','extracting','validating','reasoning','needs_review','ready','failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS extractions (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  doc_type TEXT,
  fields TEXT NOT NULL DEFAULT '{}',
  confidence REAL,
  validation TEXT NOT NULL DEFAULT '{}',
  decision TEXT NOT NULL DEFAULT '{}',
  requires_approval INTEGER NOT NULL DEFAULT 1,
  model_trace TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  input_schema TEXT NOT NULL,
  connector TEXT NOT NULL,
  secret_ref TEXT,
  risk TEXT NOT NULL DEFAULT 'medium' CHECK (risk IN ('low','medium','high')),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS playbooks (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  steps TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, name, version)
);

CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  playbook_id TEXT REFERENCES playbooks(id),
  extraction_id TEXT REFERENCES extractions(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','awaiting_approval','running','succeeded','failed','rejected')),
  approved_by TEXT REFERENCES users(id),
  result TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  actor TEXT NOT NULL,
  service TEXT NOT NULL,
  event TEXT NOT NULL,
  workflow_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_docs_tenant ON documents(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_extractions_tenant ON extractions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_tenant ON executions(tenant_id, created_at DESC);

INSERT OR IGNORE INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-000000000001','Demo Tenant');
"""

JSON_COLUMNS = {
    "fields", "validation", "decision", "model_trace",
    "input_schema", "steps", "result", "detail", "inputs", "tools"
}


def get_sqlite_path() -> str:
    url = (os.environ.get("NEON_DATABASE_URL") or os.environ.get("DATABASE_URL") or "").strip()
    if url.startswith("sqlite:"):
        p = re.sub(r"^sqlite:(?://)?", "", url)
        return p if p else "/tmp/cawrys.db"
    return os.environ.get("SQLITE_PATH", "/tmp/cawrys.db")


def is_sqlite() -> bool:
    url = (os.environ.get("NEON_DATABASE_URL") or os.environ.get("DATABASE_URL") or "").strip()
    return not url or url.startswith("sqlite")


def dict_factory(cursor, row):
    d = {}
    for idx, col in enumerate(cursor.description):
        name = col[0]
        val = row[idx]
        if name in JSON_COLUMNS and isinstance(val, str):
            try:
                val = json.loads(val)
            except Exception:
                pass
        d[name] = val
    return d


class SQLiteCursorWrapper:
    def __init__(self, cursor):
        self._cursor = cursor

    def _translate_query(self, query: str) -> str:
        # 1. Parameter placeholder %s -> ? (preserves %% and ?tatus literal % behavior)
        q = re.sub(r"(?<!%)(?:%%)*%s", lambda m: m.group(0)[:-2] + "?", query)

        # 2. SELECT DISTINCT ON query rewrite
        if "distinct on" in q.lower():
            q = re.sub(
                r"select\s+distinct\s+on\s*\(\s*name\s*\)\s+name,\s*version,\s*steps\s+from\s+playbooks\s+where\s+tenant_id=\?\s+order\s+by\s+name,\s*version\s+desc",
                "select name, max(version) as version, steps from playbooks where tenant_id=? group by name order by name",
                q,
                flags=re.IGNORECASE,
            )

        # 3. Strip Postgres typecasts (::int, ::bigint, ::text, ::numeric, ::float, ::timestamp, ::date)
        q = re.sub(r"::(?:int|bigint|text|numeric|float|timestamp|date)\b", "", q)

        # 4. Rewrite PostgreSQL date arithmetic:
        # e.g., now() - interval '15 minutes' -> datetime('now', '-15 minutes')
        # e.g., now() - interval '1 day' -> datetime('now', '-1 day')
        q = re.sub(r"now\(\)\s*-\s*interval\s*'([^']+)'", r"datetime('now', '-\1')", q, flags=re.IGNORECASE)

        # 5. Rewrite standalone now() -> CURRENT_TIMESTAMP
        q = re.sub(r"\bnow\(\)", "CURRENT_TIMESTAMP", q, flags=re.IGNORECASE)

        return q

    def execute(self, query, params=None):
        q = self._translate_query(query)
        if params is not None:
            p = [str(x) if isinstance(x, uuid.UUID) else x for x in params]
            self._cursor.execute(q, p)
        else:
            self._cursor.execute(q)
        return self

    def executemany(self, query, seq_of_params):
        q = self._translate_query(query)
        converted_seq = []
        for params in seq_of_params:
            converted_seq.append([str(x) if isinstance(x, uuid.UUID) else x for x in params])
        self._cursor.executemany(q, converted_seq)
        return self

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()

    def fetchmany(self, size=None):
        return self._cursor.fetchmany(size) if size is not None else self._cursor.fetchmany()

    @property
    def rowcount(self):
        return self._cursor.rowcount

    @property
    def description(self):
        return self._cursor.description

    @property
    def lastrowid(self):
        return self._cursor.lastrowid

    def __iter__(self):
        return iter(self._cursor)


class SQLiteConnectionWrapper:
    def __init__(self, db_path: str | None = None):
        self.db_path = db_path or get_sqlite_path()
        if self.db_path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, timeout=10.0, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=5000")
        self._conn.create_function("gen_random_uuid", 0, lambda: str(uuid.uuid4()))
        self._conn.row_factory = dict_factory
        self._last_cursor = None
        self._ensure_schema()

    def _ensure_schema(self):
        cur = self._conn.cursor()
        row = cur.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tenants'").fetchone()
        if not row:
            schema_file = Path(__file__).resolve().parents[3] / "db" / "schema_sqlite.sql"
            ddl = SCHEMA_SQL
            if schema_file.is_file():
                try:
                    ddl = schema_file.read_text(encoding="utf-8")
                except Exception:
                    pass
            self._conn.executescript(ddl)
            self._conn.commit()
        else:
            cur.execute("""
            CREATE TABLE IF NOT EXISTS login_attempts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              email TEXT NOT NULL,
              ip TEXT NOT NULL DEFAULT '',
              ok INTEGER NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_extractions_tenant ON extractions(tenant_id, created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_executions_tenant ON executions(tenant_id, created_at DESC)")

            user_cols = {col[1] if isinstance(col, tuple) else col["name"] for col in cur.execute("PRAGMA table_info(users)").fetchall()}
            if "is_active" not in user_cols:
                cur.execute("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")
            if "last_login_at" not in user_cols:
                cur.execute("ALTER TABLE users ADD COLUMN last_login_at TEXT")
            self._conn.commit()

    def cursor(self):
        return SQLiteCursorWrapper(self._conn.cursor())

    def execute(self, query, params=None):
        cur = self.cursor()
        self._last_cursor = cur
        return cur.execute(query, params)

    def executemany(self, query, seq_of_params):
        cur = self.cursor()
        self._last_cursor = cur
        return cur.executemany(query, seq_of_params)

    def fetchone(self):
        return self._last_cursor.fetchone() if self._last_cursor else None

    def fetchall(self):
        return self._last_cursor.fetchall() if self._last_cursor else []

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is None:
            self.commit()
        else:
            self.rollback()
        self.close()


def get_connection():
    if is_sqlite():
        return SQLiteConnectionWrapper()
    import psycopg
    from psycopg.rows import dict_row

    url = (os.environ.get("NEON_DATABASE_URL") or os.environ.get("DATABASE_URL") or "").strip()
    return psycopg.connect(url, row_factory=dict_row)
