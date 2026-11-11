import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set("sid", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
