// apps/web/app/api/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { COOKIE, TARGETS } from "@/lib/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ detail: "email and password required" }, { status: 400 });
  }

  // Behind the Cloudflare tunnel or reverse proxy the real client address arrives in CF-Connecting-IP / X-Forwarded-For.
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  let r: Response | null = null;

  // Try primary target, then fallback to IPv4 loopback variants to prevent ECONNREFUSED from IPv6 localhost resolution
  const candidateTargets = Array.from(new Set([
    TARGETS.intelligence,
    "http://127.0.0.1:8001",
    "http://localhost:8001",
  ])).filter(Boolean);

  let lastErr: any = null;
  for (const target of candidateTargets) {
    try {
      r = await fetch(target + "/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-IP": ip },
        body: JSON.stringify({ email: body.email, password: body.password }),
      });
      if (r) break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!r) {
    console.error("Sign-in service connection failed across targets:", candidateTargets, lastErr);
    return NextResponse.json({ detail: "the sign-in service is unreachable" }, { status: 502 });
  }

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const res = NextResponse.json({ detail: j.detail ?? "sign-in failed" }, { status: r.status });
    const retry = r.headers.get("retry-after");
    if (retry) res.headers.set("Retry-After", retry);
    return res;
  }

  const res = NextResponse.json({ ok: true, user: j.user });
  res.cookies.set(COOKIE, j.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "1",
    path: "/",
    maxAge: 12 * 3600,
  });
  // Also set 'sid' for backward compatibility
  res.cookies.set("sid", j.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "1",
    path: "/",
    maxAge: 12 * 3600,
  });
  return res;
}
