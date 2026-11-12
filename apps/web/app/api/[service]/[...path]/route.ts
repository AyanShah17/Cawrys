// apps/web/app/api/[service]/[...path]/route.ts
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
  const token = req.cookies.get(COOKIE)?.value ?? req.cookies.get("sid")?.value;
  if (!token) return NextResponse.json({ detail: "not signed in" }, { status: 401 });

  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  // Forward real client IP to upstream services for audit logging and throttling
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (ip) headers.set("x-client-ip", ip);

  const init: RequestInit & { duplex?: "half" } = { method: req.method, headers, cache: "no-store" };
  if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
    init.body = req.body;
    init.duplex = "half";
  }

  let upstream: Response | null = null;
  const candidateBases = Array.from(new Set([
    base,
    service === "intelligence" ? "http://127.0.0.1:8001" : "http://127.0.0.1:8002",
    service === "intelligence" ? "http://localhost:8001" : "http://localhost:8002",
  ])).filter(Boolean);

  let lastErr: any = null;
  for (const b of candidateBases) {
    try {
      upstream = await fetch(`${b}/${path.join("/")}${req.nextUrl.search}`, init);
      if (upstream) break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!upstream) {
    console.error(`${service} service connection failed across targets:`, candidateBases, lastErr);
    return NextResponse.json({ detail: `${service} service unreachable` }, { status: 502 });
  }
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
