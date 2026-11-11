// apps/web/lib/api.ts
// Browser-safe helpers. The browser only talks to this web app; /api/* forwards to the services with the session cookie.
export const API = { intelligence: "/api/intelligence", execution: "/api/execution" };

export type DocRow = {
  id: string;
  filename: string;
  status: string;
  created_at: string;
  doc_type: string | null;
  confidence: number | null;
};

export type ExecRow = {
  id: string;
  status: string;
  created_at: string;
  extraction_id: string | null;
  result: { reason?: string; playbook?: string; inputs?: Record<string, unknown>; results?: { tool: string }[] };
};

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    cache: "no-store",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) {
    window.location.href = "/login";
    throw new Error("your session has ended");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = j.detail;
    throw new Error(
      typeof d === "string" ? d : Array.isArray(d) ? d.map((x: any) => x.msg).join("; ") : `request failed (${r.status})`
    );
  }
  return j as T;
}

export const getJSON = <T>(url: string) => request<T>("GET", url);
export const post = <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {});
export const patch = <T>(url: string, body: unknown) => request<T>("PATCH", url, body);
export const put = <T>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {});
export const del = <T>(url: string) => request<T>("DELETE", url);
