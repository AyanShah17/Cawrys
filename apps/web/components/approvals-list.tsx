"use client";
import { useCallback, useEffect, useState } from "react";
import { API, getJSON, post, type ExecRow } from "@/lib/api";

export function ApprovalsList({ canDecide }: { canDecide: boolean }) {
  const [rows, setRows] = useState<ExecRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await getJSON<ExecRow[]>(`${API.execution}/v1/executions`)); setErr(null); }
    catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);

  async function act(id: string, action: "approve" | "reject") {
    setMsg(null);
    try { await post(`${API.execution}/v1/executions/${id}/${action}`); setMsg(`${action}d`); await load(); }
    catch (e: any) { setMsg(e.message); }
  }

  const pending = rows.filter((r) => r.status === "awaiting_approval");
  const history = rows.filter((r) => r.status !== "awaiting_approval");
  return (
    <div className="space-y-8">
      {err && <p className="text-sm text-red-400">Execution service unreachable: {err}</p>}
      {msg && <p className="text-xs text-neutral-300">{msg}</p>}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-neutral-300">Waiting for approval ({pending.length})</h3>
        {!pending.length && <p className="text-xs text-neutral-500">Nothing pending.</p>}
        <ul className="space-y-3">
          {pending.map((r) => (
            <li key={r.id} className="rounded-lg border border-white/10 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span>{r.result.playbook} <span className="font-mono text-xs text-neutral-500">{r.id.slice(0, 8)}</span></span>
                {canDecide ? (
                  <span className="space-x-2">
                    <button onClick={() => act(r.id, "approve")} className="rounded bg-emerald-400 px-3 py-1 text-xs font-medium text-black">Approve</button>
                    <button onClick={() => act(r.id, "reject")} className="rounded border border-white/20 px-3 py-1 text-xs">Reject</button>
                  </span>
                ) : <span className="text-xs text-neutral-500">approver or admin required</span>}
              </div>
              <p className="mt-1 text-xs text-neutral-400">{r.result.reason}</p>
              <pre className="mt-2 overflow-auto rounded bg-black/40 p-2 text-xs text-neutral-300">{JSON.stringify(r.result.inputs, null, 2)}</pre>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold text-neutral-300">History</h3>
        <ul className="space-y-2 text-xs">
          {history.map((r) => (
            <li key={r.id} className="flex justify-between rounded border border-white/5 px-3 py-2">
              <span>{r.result.playbook} <span className="font-mono text-neutral-500">{r.id.slice(0, 8)}</span></span>
              <span className="text-neutral-400">{r.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
