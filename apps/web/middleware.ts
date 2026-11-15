import { NextRequest, NextResponse } from "next/server";

// Pages need a session cookie; the services still validate the token themselves.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  const token = req.cookies.get("cawrys_token")?.value;
  if (token) {
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (payload?.role === "engineer") {
          const restricted = ["/marketplace", "/settings", "/approvals", "/audit"];
          if (restricted.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
            const dest = pathname.startsWith("/approvals") || pathname.startsWith("/audit") ? "/" : "/connectors";
            return NextResponse.redirect(new URL(dest, req.url));
          }
        }
      }
    } catch {}
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) return NextResponse.json({ detail: "not signed in" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
