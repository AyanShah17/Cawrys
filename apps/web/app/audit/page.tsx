// apps/web/app/audit/page.tsx
import React from "react";
import { redirect } from "next/navigation";
import { requireMe, serverGet } from "@/lib/server";
import { Badge, Card, Empty, Notice, PageHeader, tableCls, tdCls, thCls } from "@/components/ui/kit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit Trail" };

type Row = { id: number; actor: string; service: string; event: string; created_at: string };

export default async function Audit() {
  const me = await requireMe();
  if (me.role === "engineer") {
    redirect("/");
  }
  let rows: Row[] = [];
  let err: string | null = null;
  try {
    rows = await serverGet<Row[]>("intelligence", "/v1/audit");
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : "Failed to load audit events";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Trail"
        subtitle="Chronological, tamper-evident security and operational compliance log"
      />
      {err && <Notice tone="bad">{err}</Notice>}
      <Card>
        {rows.length === 0 ? (
          <Empty>No audit events recorded yet.</Empty>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Time</th>
                  <th className={thCls}>Service</th>
                  <th className={thCls}>Event</th>
                  <th className={thCls}>Actor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="transition-colors duration-150 ease-out-quart hover:bg-neutral-50/80">
                    <td className={`${tdCls} whitespace-nowrap font-mono text-xs tabular-nums text-neutral-600`}>
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>
                      <Badge variant="secondary" className="font-mono text-[11px]">
                        {r.service}
                      </Badge>
                    </td>
                    <td className={`${tdCls} min-w-[14rem] break-words font-medium text-neutral-900`}>
                      {r.event}
                    </td>
                    <td className={`${tdCls} whitespace-nowrap font-mono text-xs text-neutral-700`}>
                      {r.actor}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
