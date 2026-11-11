// apps/web/app/icon.svg/route.ts
import { getBrand } from "@/lib/brand";

// Favicon generated from the brand name and colour.
export function GET() {
  const b = getBrand();
  const initial = (b.name.match(/[A-Za-z0-9]/)?.[0] ?? "A").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${b.primary}"/><text x="32" y="44" font-family="system-ui,sans-serif" font-size="36" font-weight="700" text-anchor="middle" fill="#fff">${initial}</text></svg>`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=300",
    },
  });
}
