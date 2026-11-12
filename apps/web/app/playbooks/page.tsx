import React from "react";
import { serverGet } from "@/lib/server";
import { Card, PageHeader, Pill } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

type Playbook = { name: string; version: number; steps: { tool: string }[] };
type Exec = { id: string; status: string; created_at: string; result: { reason?: string } };

export default async function Playbooks() {
  let pbs: Playbook[] = [];
  let ex: Exec[] = [];
  let err: string | null = null;
  try {
    [pbs, ex] = await Promise.all([
      serverGet<Playbook[]>("execution", "/v1/playbooks"),
      serverGet<Exec[]>("execution", "/v1/executions"),
    ]);
  } catch (e: any) {
    err = e.message;
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Execution & Playbooks"
        subtitle="Industrial workflows, FastMCP tool pipelines, and execution history"
      />
      {err && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800">
          Execution service unreachable: {err}
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Available Playbooks">
          {pbs.length === 0 ? (
            <p className="text-xs text-neutral-400 py-4 text-center">No playbooks registered yet.</p>
          ) : (
            <ul className="space-y-2.5 text-sm">
              {pbs.map((p) => (
                <li key={p.name} className="rounded-2xl border border-neutral-200/80 bg-neutral-50/50 p-4 hover:border-neutral-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-neutral-900">{p.name}</span>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-mono text-neutral-600 border border-neutral-200">
                      v{p.version}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500 font-mono">
                    {p.steps.map((s, idx) => (
                      <React.Fragment key={idx}>
                        <span className="rounded bg-white px-2 py-0.5 border border-neutral-200 text-neutral-800">
                          {s.tool}
                        </span>
                        {idx < p.steps.length - 1 && <span className="text-neutral-400">&rarr;</span>}
                      </React.Fragment>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent Executions">
          {ex.length === 0 ? (
            <p className="text-xs text-neutral-400 py-4 text-center">No execution runs recorded yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {ex.slice(0, 10).map((e) => (
                <li key={e.id} className="flex items-center justify-between rounded-xl border border-neutral-200/60 bg-neutral-50/50 p-3 hover:border-neutral-300 transition-colors">
                  <span className="font-mono text-xs text-neutral-700">{e.id.slice(0, 8)}</span>
                  <Pill value={e.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
