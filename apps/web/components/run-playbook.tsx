// apps/web/components/run-playbook.tsx
"use client";
import React, { useState } from "react";
import Link from "next/link";
import { API, post } from "@/lib/api";

export function RunPlaybook({ extractionId, playbooks }: { extractionId: string; playbooks: string[] }) {
  const [name, setName] = useState(playbooks[0] ?? "");
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setErr(null);
    setOut(null);
    try {
      setOut(await post(`${API.execution}/v1/executions`, { playbook: name, extraction_id: extractionId }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!playbooks.length) return <p className="text-xs text-neutral-500">No playbooks available.</p>;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-900 shadow-sm focus:outline-none focus:ring-1 focus:ring-neutral-900"
        >
          {playbooks.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-full bg-neutral-950 px-4 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Running..." : "Run playbook"}
        </button>
      </div>
      {err && <p className="text-xs font-medium text-rose-600">{err}</p>}
      {out && (
        <p className="text-xs text-neutral-700">
          <span className="font-semibold">{out.status}</span>: {out.reason || "Execution finished"}
          {out.status === "awaiting_approval" && (
            <>
              {" "}
              <Link href="/approvals" className="font-semibold text-neutral-900 underline hover:text-black">
                Go to approvals
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
