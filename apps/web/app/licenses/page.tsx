// apps/web/app/licenses/page.tsx
import React from "react";
import Link from "next/link";
import { Badge, Card, PageHeader, btnGhostCls } from "@/components/ui/kit";
import { requireMe } from "@/lib/server";

export const metadata = { title: "Open source licences" };

const ITEMS: [string, string, string][] = [
  ["DeepSeek models", "MIT", "Open-weight language models used as the AI layer"],
  ["LiteLLM", "MIT", "Gateway between this system and the AI provider"],
  ["FastAPI, Pydantic, Uvicorn", "MIT / BSD", "Service framework"],
  ["psycopg", "LGPL-3.0", "PostgreSQL driver"],
  ["Next.js, React", "MIT", "Web application"],
  ["Tailwind CSS", "MIT", "Styling"],
  ["Go standard library", "BSD-3-Clause", "Edge ingest service"],
  ["PostgreSQL", "PostgreSQL licence", "Database"],
  ["cloudflared", "Apache-2.0", "Secure tunnel"],
];

export default async function Licenses() {
  await requireMe();
  return (
    <div className="space-y-6">
      <PageHeader title="Open source licences" subtitle="This product is built on the following open source software">
        <Link href="/settings" className={btnGhostCls}>
          Back to Settings
        </Link>
      </PageHeader>
      <Card>
        <ul className="divide-y divide-neutral-100 text-sm">
          {ITEMS.map(([n, l, d]) => (
            <li key={n} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-1 last:pb-1">
              <span className="min-w-0">
                <strong className="font-semibold text-neutral-950">{n}</strong>{" "}
                <span className="text-neutral-600">{d}</span>
              </span>
              <Badge variant="secondary" className="shrink-0 font-mono text-[11px]">
                {l}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-600">
          Full notices are in <code className="font-mono text-neutral-800">THIRD_PARTY_NOTICES.md</code> in the source package.
        </p>
      </Card>
    </div>
  );
}
