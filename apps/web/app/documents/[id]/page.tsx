// apps/web/app/documents/[id]/page.tsx
import { getMe, serverGet } from "@/lib/server";
import { RunPlaybook } from "@/components/run-playbook";
import { Card, PageHeader, Pill } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

type Doc = {
  id: string;
  filename: string;
  status: string;
  extraction_id: string | null;
  doc_type: string | null;
  fields: Record<string, unknown> | null;
  confidence: number | null;
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
  } catch (e: any) {
    err = e.message;
  }

  if (!doc) {
    return <main className="mx-auto max-w-4xl px-6 py-10 text-sm text-rose-600 font-medium">{err ?? "Not found"}</main>;
  }

  const issues = doc.validation?.issues ?? [];

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <PageHeader
        title={doc.filename}
        subtitle={`${doc.doc_type ?? "Technical Document"} · Status: ${doc.status} · Confidence: ${doc.confidence ? (doc.confidence * 100).toFixed(0) + "%" : "-"}`}
      >
        <Pill value={doc.status} />
      </PageHeader>

      <Card title="Extracted Engineering Fields">
        <table className="w-full text-left text-xs border-collapse">
          <tbody>
            {Object.entries(doc.fields ?? {}).map(([k, v]) => (
              <tr key={k} className="border-t border-neutral-100">
                <td className="py-2.5 font-medium text-neutral-500 w-1/3">{k}</td>
                <td className="py-2.5 font-mono text-neutral-900">{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Validation & Safety Checks">
        {issues.length === 0 ? (
          <p className="text-xs text-emerald-700 font-medium">All validation checks passed with zero safety violations.</p>
        ) : (
          <ul className="space-y-1.5 text-xs text-amber-800">
            {issues.map((i, n) => (
              <li key={n} className="p-2 rounded-xl bg-amber-50 border border-amber-200">
                <strong>{i.type}</strong>: {JSON.stringify(i.fields ?? i.field)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Proposed Reasoning & Decision">
        <p className="text-xs text-neutral-800 leading-relaxed">{doc.decision?.summary || "No automated summary generated."}</p>
        {(doc.decision?.proposed_actions ?? []).length > 0 && (
          <div className="mt-3 space-y-1">
            <div className="text-xs font-semibold text-neutral-700">Proposed Actions:</div>
            <ul className="space-y-1 text-xs text-neutral-600">
              {(doc.decision?.proposed_actions ?? []).map((a, n) => (
                <li key={n} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-neutral-900" />
                  <span>{a.action}</span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-mono border border-neutral-200 text-neutral-700">
                    {a.risk} risk
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title="Execute Playbook">
        {!me || me.role === "viewer" ? (
          <p className="text-xs text-neutral-500">Viewers cannot run execution playbooks.</p>
        ) : doc.extraction_id && !doc.validation?.needs_review ? (
          <RunPlaybook extractionId={doc.extraction_id} playbooks={playbooks} />
        ) : (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
            Resolve validation issues before triggering shop floor execution.
          </p>
        )}
      </Card>
    </main>
  );
}
