-- Cawrys schema for Neon (Postgres). Shared tenant/audit across both services.
create extension if not exists pgcrypto;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  email text not null unique,
  password_hash text not null default '',
  role text not null default 'viewer' check (role in ('admin','engineer','approver','viewer')),
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists login_attempts (
  id bigserial primary key,
  email text not null,
  ip text not null default '',
  ok boolean not null,
  created_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  filename text not null,
  mime_type text not null,
  storage_key text not null,           -- Cloudflare R2 object key
  status text not null default 'received'
    check (status in ('received','extracting','validating','reasoning','needs_review','ready','failed')),
  created_at timestamptz not null default now()
);

create table if not exists extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  doc_type text,
  fields jsonb not null default '{}',
  confidence numeric(4,3),
  validation jsonb not null default '{}',
  decision jsonb not null default '{}',   -- reasoning output / processing instructions
  requires_approval boolean not null default true,
  model_trace jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists tools (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  description text,
  input_schema jsonb not null,           -- JSON Schema
  connector text not null,
  secret_ref text,                       -- reference only, never the secret
  risk text not null default 'medium' check (risk in ('low','medium','high')),
  unique (tenant_id, name)
);

create table if not exists playbooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  version int not null default 1,
  steps jsonb not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name, version)
);

create table if not exists executions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  playbook_id uuid references playbooks(id),
  extraction_id uuid references extractions(id),
  status text not null default 'pending'
    check (status in ('pending','awaiting_approval','running','succeeded','failed','rejected')),
  approved_by uuid references users(id),
  result jsonb,
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id),
  actor text not null,
  service text not null,
  event text not null,
  workflow_id uuid,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_docs_tenant on documents(tenant_id, created_at desc);
create index if not exists idx_audit_tenant on audit_log(tenant_id, created_at desc);
create index if not exists idx_login_attempts_email on login_attempts(email, created_at desc);
create index if not exists idx_login_attempts_ip on login_attempts(ip, created_at desc);
create index if not exists idx_users_tenant on users(tenant_id);
create index if not exists idx_extractions_tenant on extractions(tenant_id, created_at desc);
create index if not exists idx_executions_tenant on executions(tenant_id, created_at desc);

insert into tenants (id, name) values ('00000000-0000-0000-0000-000000000001','Demo Tenant')
on conflict do nothing;
