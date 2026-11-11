// apps/web/lib/types.ts

export type UserRow = {
  id: string;
  email: string;
  role: "admin" | "engineer" | "approver" | "viewer";
  is_active: boolean | number;
  last_login_at: string | null;
  created_at?: string;
};

export type DocPerDay = {
  day: string;
  ready: number;
  needs_review: number;
  failed: number;
};

export type ModelUsage = {
  model: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  tokens: number;
  avg_latency_ms: number;
};

export type RecentDoc = {
  id: string;
  filename: string;
  doc_type: string | null;
  status: string;
  created_at: string;
  confidence?: number | null;
};

export type RecentAudit = {
  id: number;
  actor: string;
  service: string;
  event: string;
  created_at: string;
};

export type DocSummary = {
  days: number;
  documents: {
    total: number;
    by_status: Record<string, number>;
    per_day: DocPerDay[];
  };
  ai: {
    by_model: ModelUsage[];
    total_tokens: number;
    total_calls: number;
  };
  avg_confidence: number | null;
  recent_documents: RecentDoc[];
  recent_audit: RecentAudit[];
};

export type ExecPerDay = {
  day: string;
  succeeded: number;
  awaiting_approval: number;
  rejected_or_failed: number;
};

export type TopPlaybook = {
  name: string;
  runs: number;
  succeeded: number;
};

export type PendingApproval = {
  id: string;
  playbook: string;
  reason: string;
  created_at: string;
};

export type ExecSummary = {
  days: number;
  executions: {
    total?: number;
    period_total: number;
    by_status: Record<string, number>;
    per_day: ExecPerDay[];
    success_rate: number | null;
  };
  playbooks: number;
  tools: { total: number };
  top_playbooks: TopPlaybook[];
  pending_approvals: PendingApproval[];
};

export type ServiceHealth = {
  name: string;
  ok: boolean;
  latency_ms?: number;
  detail?: string;
};

export type SystemStatus = {
  ok: boolean;
  services: ServiceHealth[];
  version: string;
  env: string;
  storage: string;
  demo_mode: boolean;
  config?: {
    brand: string;
    ai_roles: Record<string, string>;
    max_upload_mb: number;
  };
};

export type DocRow = {
  id: string;
  tenant_id?: string;
  filename: string;
  mime_type?: string;
  storage_key?: string;
  status: string;
  created_at: string;
  doc_type?: string | null;
  confidence?: number | null;
  fields?: Record<string, any>;
  requires_approval?: boolean;
};

export type Page<T> = {
  items: T[];
  total: number;
  limit?: number;
  offset?: number;
};
