"use client";
import React, { useCallback, useEffect, useState } from "react";
import { API, getJSON, post, type ExecRow } from "@/lib/api";
import { Card, Pill } from "@/components/ui/kit";

export function ApprovalsList({ canDecide }: { canDecide: boolean }) {
  const [rows, setRows] = useState<ExecRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await getJSON<ExecRow[]>(`${API.execution}/v1/executions`));
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function act(id: string, action: "approve" | "reject") {
    setMsg(null);
    try {
      await post(`${API.execution}/v1/executions/${id}/${action}`);
      setMsg(`${action}d successfully.`);
      await load();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  const pending = rows.filter((r) => r.status === "awaiting_approval");
  const history = rows.filter((r) => r.status !== "awaiting_approval");

  return (
    <div className="space-y-6">
      {err && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800">
          Execution service unreachable: {err}
        </div>
      )}
      {msg && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800">
          {msg}
        </div>
      )}

      <Card title={`Waiting for Approval (${pending.length})`}>
        {!pending.length ? (
          <p className="text-xs text-neutral-400 py-6 text-center">No runs currently waiting for approval.</p>
        ) : (
          <ul className="space-y-4">
            {pending.map((r) => (
              <li key={r.id} className="rounded-2xl border border-neutral-200/80 bg-neutral-50/50 p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-neutral-900 text-sm">{r.result.playbook}</span>
                    <span className="font-mono text-xs text-neutral-500 rounded bg-neutral-200/60 px-1.5 py-0.5">
                      {r.id.slice(0, 8)}
                    </span>
                  </div>
                  {canDecide ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => act(r.id, "approve")}
                        className="rounded-full bg-emerald-600 text-white hover:bg-emerald-700 px-4 py-1.5 text-xs font-semibold shadow-xs transition active:scale-95"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => act(r.id, "reject")}
                        className="rounded-full border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100 px-4 py-1.5 text-xs font-semibold shadow-xs transition active:scale-95"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-neutral-400">Approver or admin role required</span>
                  )}
                </div>
                {r.result.reason && (
                  <p className="text-xs text-neutral-600 leading-relaxed">{r.result.reason}</p>
                )}
                {r.result.inputs && (
                  <pre className="overflow-auto rounded-xl bg-neutral-900 p-3 text-xs text-neutral-200 font-mono">
                    {JSON.stringify(r.result.inputs, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Approval History">
        {history.length === 0 ? (
          <p className="text-xs text-neutral-400 py-4 text-center">No past executions.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {history.slice(0, 15).map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-xl border border-neutral-200/60 bg-neutral-50/50 p-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-neutral-900">{r.result.playbook}</span>
                  <span className="font-mono text-neutral-400">{r.id.slice(0, 8)}</span>
                </div>
                <Pill value={r.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
