// apps/web/app/playbooks/page.tsx
import React from "react";
import { PageHeader } from "@/components/ui/kit";
import { PlaybooksManager, type Exec, type Playbook } from "@/components/playbooks-manager";
import { requireMe, safe, serverGet } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Execution & Playbooks" };

export default async function PlaybooksPage() {
  const me = await requireMe();

  let pbs: Playbook[] = [];
  let ex: Exec[] = [];
  let err: string | null = null;

  try {
    const [pbsRes, exRes] = await Promise.all([
      safe(serverGet<Playbook[]>("execution", "/v1/playbooks")),
      safe(serverGet<Exec[]>("execution", "/v1/executions")),
    ]);
    pbs = pbsRes ?? [];
    ex = exRes ?? [];
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
          Execution service notice: {err}
        </div>
      )}
      <PlaybooksManager
        initialPlaybooks={pbs}
        initialExecutions={ex}
        role={me.role}
      />
    </div>
  );
}
