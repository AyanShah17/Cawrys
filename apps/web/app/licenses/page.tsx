// apps/web/app/licenses/page.tsx
import React from "react";
import { Card, PageHeader } from "@/components/ui/kit";
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
      <PageHeader title="Open source licences" subtitle="This product is built on the following open source software" />
      <Card>
        <ul className="divide-y divide-white/5 text-sm">
          {ITEMS.map(([n, l, d]) => (
            <li key={n} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span>
                <b className="font-medium">{n}</b> <span className="text-neutral-500">{d}</span>
              </span>
              <span className="text-xs text-neutral-400">{l}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-neutral-500">
          Full notices are in THIRD_PARTY_NOTICES.md in the source package.
        </p>
      </Card>
    </div>
  );
}
