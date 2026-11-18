// apps/web/components/approvals-list.tsx
"use client";
import React, { useCallback, useEffect, useState } from "react";
import { API, getJSON, post, type ExecRow } from "@/lib/api";
import { Button, Card, Empty, Notice, Pill, tableCls, tdCls, thCls } from "@/components/ui/kit";

export function ApprovalsList({ canDecide }: { canDecide: boolean }) {
  const [rows, setRows] = useState<ExecRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await getJSON<ExecRow[]>(`${API.execution}/v1/executions`));
      setErr(null);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Service unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function act(id: string, action: "approve" | "reject") {
    setBusyId(id);
    setMsg(null);
    try {
      await post(`${API.execution}/v1/executions/${id}/${action}`);
      setMsg({ ok: true, text: `Execution ${action}d successfully.` });
      await load();
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : `Failed to ${action} execution` });
    } finally {
      setBusyId(null);
    }
  }

  const pending = rows.filter((r) => r.status === "awaiting_approval");
  const history = rows.filter((r) => r.status !== "awaiting_approval");

  return (
    <div className="space-y-6">
      {err && (
        <Notice tone="bad">
          Execution service unreachable: {err}
        </Notice>
      )}
      {msg && (
        msg.ok ? (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
            {msg.text}
          </div>
        ) : (
          <Notice tone="bad">{msg.text}</Notice>
        )
      )}

      <Card title={`Waiting for Approval (${pending.length})`}>
        {loading ? (
          <div className="py-6 text-center text-xs text-neutral-600">Loading pending approvals...</div>
        ) : !pending.length ? (
          <Empty>No runs currently waiting for approval.</Empty>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {pending.map((r) => {
              const isBusy = busyId === r.id;
              return (
                <li key={r.id} className="space-y-3 py-4 first:pt-1 last:pb-1">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-neutral-950">{r.result.playbook}</span>
                      <span className="rounded-md border border-neutral-200 bg-neutral-100 px-1.5 py-0.5 font-mono text-xs tabular-nums text-neutral-700">
                        {r.id.slice(0, 8)}
                      </span>
                      <Pill value={r.status} />
                    </div>
                    {canDecide ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => act(r.id, "approve")}
                          className="bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:ring-emerald-700"
                        >
                          {isBusy ? "Processing..." : "Approve"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => act(r.id, "reject")}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-neutral-600">Approver or admin role required</span>
                    )}
                  </div>
                  {r.result.reason && (
                    <p className="text-xs leading-relaxed text-neutral-700">{r.result.reason}</p>
                  )}
                  {r.result.inputs && (
                    <pre className="overflow-auto rounded-xl border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs leading-relaxed text-neutral-200">
                      {JSON.stringify(r.result.inputs, null, 2)}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Approval History">
        {loading ? (
          <div className="py-6 text-center text-xs text-neutral-600">Loading execution history...</div>
        ) : history.length === 0 ? (
          <Empty>No past executions.</Empty>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Playbook</th>
                  <th className={thCls}>Execution ID</th>
                  <th className={`${thCls} text-right`}>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 15).map((r) => (
                  <tr key={r.id} className="transition-colors duration-150 ease-out-quart hover:bg-neutral-50/80">
                    <td className={`${tdCls} font-medium text-neutral-950`}>{r.result.playbook}</td>
                    <td className={`${tdCls} font-mono text-xs tabular-nums text-neutral-600`}>
                      {r.id.slice(0, 8)}
                    </td>
                    <td className={`${tdCls} pr-0 text-right`}>
                      <Pill value={r.status} />
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
