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
  let r: Response;
  try {
    r = await fetch(TARGETS.intelligence + "/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-IP": ip },
      body: JSON.stringify({ email: body.email, password: body.password }),
    });
  } catch {
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
