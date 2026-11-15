// apps/web/app/playbooks/page.tsx
import React from "react";
import { PageHeader } from "@/components/ui/kit";
import { PlaybooksManager, type Exec, type Playbook, type RegisteredTool } from "@/components/playbooks-manager";
import { requireMe, safe, serverGet } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Execution & Playbooks" };

export default async function PlaybooksPage() {
  const me = await requireMe();

  let pbs: Playbook[] = [];
  let ex: Exec[] = [];
  let tools: RegisteredTool[] = [];
  let err: string | null = null;

  try {
    const [pbsRes, exRes, toolsRes] = await Promise.all([
      safe(serverGet<Playbook[]>("execution", "/v1/playbooks")),
      safe(serverGet<Exec[]>("execution", "/v1/executions")),
      safe(serverGet<RegisteredTool[]>("execution", "/v1/tools")),
    ]);
    pbs = pbsRes ?? [];
    ex = exRes ?? [];
    tools = toolsRes ?? [];
  } catch (e: any) {
    err = e.message;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Execution & Playbooks"
        subtitle="Visual pipeline canvas, AI playbook editing, FastMCP tools, and execution history"
      />
      {err && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800">
          Execution service notice: {err}
        </div>
      )}
      <PlaybooksManager
        initialPlaybooks={pbs}
        initialExecutions={ex}
        initialTools={tools}
        role={me.role}
      />
    </div>
  );
}
