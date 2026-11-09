import { serverGet } from "@/lib/server";

export const dynamic = "force-dynamic";

type Row = { id: number; actor: string; service: string; event: string; created_at: string };

export default async function Audit() {
  let rows: Row[] = [];
  let err: string | null = null;
  try { rows = await serverGet<Row[]>("intelligence", "/v1/audit"); } catch (e: any) { err = e.message; }
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h2 className="mb-4 text-xl font-semibold">Audit trail</h2>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <table className="w-full text-left text-xs">
        <thead className="text-neutral-500"><tr><th>Time</th><th>Service</th><th>Event</th><th>Actor</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-white/5">
              <td className="py-1.5">{new Date(r.created_at).toLocaleString()}</td>
              <td>{r.service}</td><td>{r.event}</td><td>{r.actor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
