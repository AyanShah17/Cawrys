import { NextRequest, NextResponse } from "next/server";

// Pages need a session cookie; the services still validate the token themselves.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  if (req.cookies.get("cawrys_token")) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ detail: "not signed in" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
