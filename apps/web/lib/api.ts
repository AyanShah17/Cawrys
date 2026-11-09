// Browser-safe helpers. The browser only talks to this web app; /api/* proxies to the services with the session cookie.
export const API = { intelligence: "/api/intelligence", execution: "/api/execution" };

export type DocRow = {
  id: string; filename: string; status: string; created_at: string;
  doc_type: string | null; confidence: number | null;
};

export type ExecRow = {
  id: string; status: string; created_at: string; extraction_id: string | null;
  result: { reason?: string; playbook?: string; inputs?: Record<string, unknown>; results?: { tool: string }[] };
};

export async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (r.status === 401) { window.location.href = "/login"; throw new Error("session expired"); }
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { window.location.href = "/login"; throw new Error("session expired"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : `request failed (${r.status})`);
  return j as T;
}
