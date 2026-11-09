// Routes /intelligence/* and /execution/* to the customer's origins.
// Replace the token check with Cloudflare Access / JWT validation in production.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const auth = request.headers.get("authorization");
    if (!auth) return new Response("unauthorized", { status: 401 });

    let origin;
    if (url.pathname.startsWith("/intelligence/")) origin = env.INTELLIGENCE_ORIGIN;
    else if (url.pathname.startsWith("/execution/")) origin = env.EXECUTION_ORIGIN;
    else return new Response("not found", { status: 404 });

    const path = url.pathname.replace(/^\/(intelligence|execution)/, "");
    return fetch(new Request(origin + path + url.search, request));
  },
};
