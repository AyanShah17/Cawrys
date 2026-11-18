// apps/web/components/run-playbook.tsx
"use client";
import React, { useState } from "react";
import Link from "next/link";
import { API, post } from "@/lib/api";
import { Button, Pill, inputCls } from "@/components/ui/kit";

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

  if (!playbooks.length) return <p className="text-xs text-neutral-600">No playbooks available.</p>;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Select playbook"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${inputCls} w-auto min-w-[180px] text-xs`}
        >
          {playbooks.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <Button type="button" onClick={run} disabled={busy} size="sm">
          {busy ? "Running..." : "Run playbook"}
        </Button>
      </div>
      {err && (
        <p role="alert" className="text-xs font-medium text-rose-700">
          {err}
        </p>
      )}
      {out && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-700">
          <Pill value={out.status} />
          <span>{out.reason || "Execution finished"}</span>
          {out.status === "awaiting_approval" && (
            <Link
              href="/approvals"
              className="rounded font-semibold text-neutral-950 underline underline-offset-4 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1"
            >
              Go to approvals
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
