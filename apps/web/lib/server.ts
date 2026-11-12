// apps/web/lib/server.ts
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const TARGETS: Record<string, string> = {
  intelligence: process.env.INTERNAL_INTELLIGENCE_URL ?? process.env.INTELLIGENCE_URL ?? "http://127.0.0.1:8001",
  execution: process.env.INTERNAL_EXECUTION_URL ?? process.env.EXECUTION_URL ?? "http://127.0.0.1:8002",
};
export const COOKIE = "cawrys_token";

export type Me = {
  id?: string;
  email: string;
  role: "admin" | "engineer" | "approver" | "viewer";
  tenant_id: string;
  tenant_name?: string;
};

export class AuthError extends Error {}

export async function getToken() {
  const c = await cookies();
  return c.get(COOKIE)?.value ?? c.get("sid")?.value ?? null;
}

/** Server components: fetch with the caller's token. A rejected token raises AuthError (see safe()). */
export async function serverGet<T>(service: "intelligence" | "execution", path: string): Promise<T> {
  const token = await getToken();
  if (!token) throw new AuthError();
  const r = await fetch(TARGETS[service] + path, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) throw new AuthError();
  if (!r.ok) throw new Error(`${service} responded ${r.status}`);
  return r.json();
}

/** Resolves to null when a service is down, so one failing panel never takes the whole page with it.
 *  An expired or revoked session sends the user to sign in again. */
export async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    return null;
  }
}

export async function getMe(): Promise<Me | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const r = await fetch(TARGETS.intelligence + "/v1/auth/me", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function requireMe(): Promise<Me> {
  const me = await getMe();
  if (!me) redirect("/login");
  return me;
}
