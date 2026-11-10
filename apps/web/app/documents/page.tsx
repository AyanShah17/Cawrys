// apps/web/app/documents/page.tsx
import React from "react";
import Link from "next/link";
import { Upload } from "@/components/upload";
import { Card, Empty, Notice, PageHeader, Pill, btnGhostCls, inputCls, tableCls, tdCls, thCls } from "@/components/ui/kit";
import { label, pct, when } from "@/lib/format";
import { requireMe, safe, serverGet } from "@/lib/server";
import type { DocRow, Page } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };
const PAGE = 20;
const STATUSES = ["ready", "needs_review", "failed", "extracting"];

export default async function Documents({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const me = await requireMe();
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String((page - 1) * PAGE) });
  if (sp.status && STATUSES.includes(sp.status)) qs.set("status", sp.status);
  if (sp.q) qs.set("q", sp.q.slice(0, 100));

  const rawData = await safe(serverGet<Page<DocRow> | DocRow[]>("intelligence", `/v1/documents?${qs}`));
  const data: Page<DocRow> | null = rawData
    ? Array.isArray(rawData)
      ? { items: rawData, total: rawData.length, limit: PAGE, offset: (page - 1) * PAGE }
      : rawData
    : null;

  const canUpload = me.role === "admin" || me.role === "engineer";
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const link = (p: number) => {
    const q = new URLSearchParams();
    if (sp.status) q.set("status", sp.status);
    if (sp.q) q.set("q", sp.q);
    q.set("page", String(p));
    return `/documents?${q}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Documents" subtitle="Everything that has been read, checked and reasoned about" />
      {canUpload && (
        <Card title="Upload">
          <Upload />
        </Card>
      )}
      <Card>
        <form method="get" className="mb-4 flex flex-wrap gap-2">
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Search file names"
            className={`${inputCls} max-w-xs`}
            aria-label="Search file names"
          />
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className={`${inputCls} max-w-[11rem]`}
            aria-label="Status"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{label(s)}</option>
            ))}
          </select>
          <button className={btnGhostCls}>Filter</button>
        </form>
        {!data ? (
          <Notice tone="bad">The documents service is not responding.</Notice>
        ) : data.items.length === 0 ? (
          <Empty>No documents match.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th className={thCls}>File</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Confidence</th>
                  <th className={thCls}>Received</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((d) => (
                  <tr key={d.id}>
                    <td className={`${tdCls} max-w-[16rem] truncate`}>
                      <Link className="hover:underline" href={`/documents/${d.id}`}>{d.filename}</Link>
                    </td>
                    <td className={`${tdCls} text-neutral-400`}>{d.doc_type ? label(d.doc_type) : "–"}</td>
                    <td className={tdCls}><Pill value={d.status} /></td>
                    <td className={`${tdCls} tabular-nums`}>{pct(d.confidence)}</td>
                    <td className={`${tdCls} text-neutral-400`}>{when(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > PAGE && (
          <div className="mt-4 flex items-center justify-between text-xs text-neutral-400">
            <span>{data.total} documents · page {page} of {pages}</span>
            <span className="space-x-2">
              {page > 1 && <Link className={btnGhostCls} href={link(page - 1)}>Previous</Link>}
              {page < pages && <Link className={btnGhostCls} href={link(page + 1)}>Next</Link>}
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}
