"use client";
import { useState } from "react";
import { API, post } from "@/lib/api";

export function RunPlaybook({ extractionId, playbooks }: { extractionId: string; playbooks: string[] }) {
  const [name, setName] = useState(playbooks[0] ?? "");
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true); setErr(null); setOut(null);
    try {
      setOut(await post(`${API.execution}/v1/executions`, { playbook: name, extraction_id: extractionId }));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  if (!playbooks.length) return <p className="text-xs text-neutral-500">No playbooks available.</p>;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex gap-2">
        <select value={name} onChange={(e) => setName(e.target.value)}
          className="rounded border border-white/15 bg-black px-2 py-1">
          {playbooks.map((p) => <option key={p}>{p}</option>)}
        </select>
        <button onClick={run} disabled={busy}
          className="rounded bg-white px-3 py-1 font-medium text-black disabled:opacity-50">
          {busy ? "Running…" : "Run playbook"}
        </button>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
      {out && (
        <p className="text-xs text-neutral-300">
          {out.status}: {out.reason}. {out.status === "awaiting_approval" && <a className="underline" href="/approvals">Go to approvals</a>}
        </p>
      )}
    </div>
  );
}
