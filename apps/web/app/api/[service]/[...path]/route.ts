import { NextRequest, NextResponse } from "next/server";
import { COOKIE, TARGETS } from "@/lib/server";

// Forwards browser calls to the backend services, adding the bearer token from the httpOnly cookie.
async function handle(req: NextRequest, ctx: { params: Promise<{ service: string; path: string[] }> }) {
  const { service, path } = await ctx.params;
  const base = TARGETS[service];
  if (!base) return NextResponse.json({ detail: "unknown service" }, { status: 404 });
  if (path[0] !== "v1" || path.some((p) => p === ".." || p === "." || p.includes("%") || p.includes("\\"))) {
    return NextResponse.json({ detail: "invalid path" }, { status: 400 });
  }
  if (path[1] === "auth" && path[2] === "login") return NextResponse.json({ detail: "use /api/login" }, { status: 404 });

  if (req.method !== "GET") {
    // CSRF guard on top of SameSite=Lax: a cross-site Origin is refused.
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== req.headers.get("host")) {
      return NextResponse.json({ detail: "cross-origin request refused" }, { status: 403 });
    }
  }
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return NextResponse.json({ detail: "not signed in" }, { status: 401 });

  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  const init: RequestInit & { duplex?: "half" } = { method: req.method, headers, cache: "no-store" };
  if (req.method !== "GET") { init.body = req.body; init.duplex = "half"; }

  let upstream: Response;
  try {
    upstream = await fetch(`${base}/${path.join("/")}${req.nextUrl.search}`, init);
  } catch {
    return NextResponse.json({ detail: `${service} service unreachable` }, { status: 502 });
  }
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export { handle as GET, handle as POST };
