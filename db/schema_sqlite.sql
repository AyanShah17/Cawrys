-- Cawrys SQLite schema for local offline development.
-- Compatible with SQLite 3.35+ (supports RETURNING and UPSERT).

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

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  task TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','awaiting_approval','completed','failed','rejected')),
  current_step INTEGER NOT NULL DEFAULT 0,
  max_steps INTEGER NOT NULL DEFAULT 10,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('action','observation')),
  name TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_docs_tenant ON documents(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_extractions_tenant ON extractions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_tenant ON executions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_tenant ON agent_sessions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_session_seq ON agent_events(session_id, seq ASC);

INSERT OR IGNORE INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-000000000001','Demo Tenant');
