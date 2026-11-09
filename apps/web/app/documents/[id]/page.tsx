import { getMe, serverGet } from "@/lib/server";
import { RunPlaybook } from "@/components/run-playbook";

export const dynamic = "force-dynamic";

type Doc = {
  id: string; filename: string; status: string; extraction_id: string | null; doc_type: string | null;
  fields: Record<string, unknown> | null; confidence: number | null;
  validation: { issues?: { type: string; fields?: unknown; field?: string }[]; needs_review?: boolean } | null;
  decision: { summary?: string; proposed_actions?: { action: string; risk: string }[]; open_questions?: string[] } | null;
};

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let doc: Doc | null = null;
  let playbooks: string[] = [];
  let err: string | null = null;
  const me = await getMe();
  try {
    doc = await serverGet<Doc>("intelligence", `/v1/documents/${encodeURIComponent(id)}`);
    playbooks = (await serverGet<{ name: string }[]>("execution", "/v1/playbooks")).map((p) => p.name);
  } catch (e: any) { err = e.message; }

  if (!doc) return <main className="mx-auto max-w-4xl px-6 py-10 text-sm text-red-400">{err ?? "Not found"}</main>;
  const issues = doc.validation?.issues ?? [];
  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <header>
        <h2 className="text-xl font-semibold">{doc.filename}</h2>
        <p className="text-xs text-neutral-400">{doc.doc_type ?? "unknown type"} · {doc.status} · confidence {doc.confidence ?? "-"}</p>
      </header>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-300">Extracted fields</h3>
        <table className="w-full text-left text-xs">
          <tbody>
            {Object.entries(doc.fields ?? {}).map(([k, v]) => (
              <tr key={k} className="border-t border-white/5"><td className="py-1.5 text-neutral-400">{k}</td><td>{String(v)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-300">Validation</h3>
        {issues.length === 0 ? <p className="text-xs text-emerald-400">No issues.</p> : (
          <ul className="space-y-1 text-xs text-amber-300">
            {issues.map((i, n) => <li key={n}>{i.type}: {JSON.stringify(i.fields ?? i.field)}</li>)}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-300">Proposed by the reasoning step</h3>
        <p className="text-xs text-neutral-300">{doc.decision?.summary}</p>
        <ul className="mt-1 text-xs text-neutral-400">
          {(doc.decision?.proposed_actions ?? []).map((a, n) => <li key={n}>{a.action} ({a.risk} risk)</li>)}
          {(doc.decision?.open_questions ?? []).map((q, n) => <li key={`q${n}`}>Open: {q}</li>)}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-300">Execute</h3>
        {!me || me.role === "viewer"
          ? <p className="text-xs text-neutral-500">Viewers cannot run playbooks.</p>
          : doc.extraction_id && !doc.validation?.needs_review
          ? <RunPlaybook extractionId={doc.extraction_id} playbooks={playbooks} />
          : <p className="text-xs text-amber-300">Resolve the validation issues before running a playbook.</p>}
      </section>
    </main>
  );
}
