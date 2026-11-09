import { serverGet } from "@/lib/server";

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
  } catch (e: any) { err = e.message; }
  return (
    <main className="mx-auto grid max-w-5xl gap-8 px-6 py-10 md:grid-cols-2">
      {err && <p className="text-sm text-red-400 md:col-span-2">Execution service unreachable: {err}</p>}
      <section>
        <h2 className="mb-3 text-xl font-semibold">Playbooks</h2>
        <ul className="space-y-2 text-sm">
          {pbs.map((p) => (
            <li key={p.name} className="rounded-lg border border-white/10 p-3">
              {p.name} <span className="text-neutral-500">v{p.version}</span>
              <div className="text-xs text-neutral-400">{p.steps.map((s) => s.tool).join(" → ")}</div>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 text-xl font-semibold">Executions</h2>
        <ul className="space-y-2 text-sm">
          {ex.map((e) => (
            <li key={e.id} className="rounded-lg border border-white/10 p-3">
              <span className="font-mono text-xs">{e.id.slice(0, 8)}</span> {e.status}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
