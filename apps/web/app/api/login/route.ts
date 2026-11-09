import { NextRequest, NextResponse } from "next/server";
import { COOKIE, TARGETS } from "@/lib/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) return NextResponse.json({ detail: "email and password required" }, { status: 400 });
  let r: Response;
  try {
    r = await fetch(TARGETS.intelligence + "/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: body.email, password: body.password }),
    });
  } catch {
    return NextResponse.json({ detail: "authentication service unreachable" }, { status: 502 });
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ detail: j.detail ?? "login failed" }, { status: r.status });
  const res = NextResponse.json({ ok: true, user: j.user });
  res.cookies.set(COOKIE, j.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "1",
    path: "/",
    maxAge: 12 * 3600,
  });
  return res;
}
