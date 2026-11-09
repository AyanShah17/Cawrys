import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const TARGETS: Record<string, string> = {
  intelligence: process.env.INTERNAL_INTELLIGENCE_URL ?? process.env.INTELLIGENCE_URL ?? "http://localhost:8001",
  execution: process.env.INTERNAL_EXECUTION_URL ?? process.env.EXECUTION_URL ?? "http://localhost:8002",
};
export const COOKIE = "cawrys_token";

export type Me = { email: string; role: "admin" | "engineer" | "approver" | "viewer"; tenant_id: string };

export async function getToken() {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

/** Server components: fetch with the caller's token. A rejected token sends the user to /login. */
export async function serverGet<T>(service: "intelligence" | "execution", path: string): Promise<T> {
  const token = await getToken();
  if (!token) redirect("/login");
  const r = await fetch(TARGETS[service] + path, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) redirect("/login");
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export async function getMe(): Promise<Me | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const r = await fetch(TARGETS.intelligence + "/v1/auth/me", { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
