import React from "react";
import { serverGet } from "@/lib/server";
import { Card, PageHeader, tableCls, tdCls, thCls } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

type Row = { id: number; actor: string; service: string; event: string; created_at: string };

export default async function Audit() {
  let rows: Row[] = [];
  let err: string | null = null;
  try {
    rows = await serverGet<Row[]>("intelligence", "/v1/audit");
  } catch (e: any) {
    err = e.message;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Trail"
        subtitle="Chronological, tamper-evident security and operational compliance log"
      />
      {err && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800">
          {err}
        </div>
      )}
      <Card>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-400">No audit events recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
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
                  <tr key={r.id} className="hover:bg-neutral-50 transition-colors">
                    <td className={`${tdCls} font-mono text-xs text-neutral-500`}>
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className={`${tdCls} font-semibold text-neutral-900`}>{r.service}</td>
                    <td className={`${tdCls} text-neutral-800`}>{r.event}</td>
                    <td className={`${tdCls} font-mono text-xs text-neutral-600`}>{r.actor}</td>
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
