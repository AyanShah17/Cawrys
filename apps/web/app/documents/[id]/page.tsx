// apps/web/app/documents/[id]/page.tsx
import React from "react";
import Link from "next/link";
import { getMe, serverGet } from "@/lib/server";
import { RunPlaybook } from "@/components/run-playbook";
import { Card, Empty, Notice, PageHeader, Pill, btnCls, btnGhostCls, tableCls, tdCls, thCls } from "@/components/ui/kit";

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

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let doc: Doc | null = null;
  let playbooks: string[] = [];
  let err: string | null = null;
  const me = await getMe();
  try {
    doc = await serverGet<Doc>("intelligence", `/v1/documents/${encodeURIComponent(id)}`);
    playbooks = (await serverGet<{ name: string }[]>("execution", "/v1/playbooks")).map((p) => p.name);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : "Failed to load document";
  }

  if (!doc) {
    return (
      <div className="space-y-4">
        <PageHeader title="Document unavailable">
          <Link href="/documents" className={btnGhostCls}>Back to Documents</Link>
        </PageHeader>
        <Notice tone="bad">{err ?? "Document not found."}</Notice>
      </div>
    );
  }

  const issues = doc.validation?.issues ?? [];
  const fieldEntries = Object.entries(doc.fields ?? {});
  const confidenceText = doc.confidence !== null && doc.confidence !== undefined
    ? `${(doc.confidence * 100).toFixed(0)}%`
    : "-";

  return (
    <div className="space-y-6">
      <PageHeader
        title={doc.filename}
        subtitle={`${doc.doc_type ?? "Technical Document"} · Status: ${doc.status} · Confidence: ${confidenceText}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Pill value={doc.status} />
          <Link href="/documents" className={btnGhostCls}>
            All Documents
          </Link>
          <a
            href={`/api/intelligence/v1/documents/${encodeURIComponent(doc.id)}/file`}
            target="_blank"
            rel="noopener noreferrer"
            className={btnCls}
            title="Download or view original uploaded file"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>Download Original File</span>
          </a>
        </div>
      </PageHeader>

      <Card title="Extracted Engineering Fields">
        {fieldEntries.length === 0 ? (
          <Empty>No extracted fields recorded for this document.</Empty>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th className={`${thCls} w-1/3`}>Field</th>
                  <th className={thCls}>Extracted Value</th>
                </tr>
              </thead>
              <tbody>
                {fieldEntries.map(([k, v]) => {
                  const formatted = formatFieldValue(v);
                  const isLong = formatted.length > 400 || formatted.includes("\n");
                  return (
                    <tr key={k} className="align-top transition-colors duration-150 ease-out-quart hover:bg-neutral-50/80">
                      <td className={`${tdCls} w-1/3 font-medium text-neutral-700`}>{k}</td>
                      <td className={`${tdCls} min-w-0 font-mono text-xs text-neutral-950`}>
                        {isLong ? (
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs leading-relaxed text-neutral-900">
                            {formatted}
                          </pre>
                        ) : (
                          <span className="break-words">{formatted}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Validation & Safety Checks">
        {issues.length === 0 ? (
          <p className="text-sm font-medium text-emerald-800">
            All validation checks passed with zero safety violations.
          </p>
        ) : (
          <ul className="space-y-2 text-xs text-amber-900">
            {issues.map((i, n) => (
              <li key={n} className="rounded-xl border border-amber-200 bg-amber-50 p-3 leading-relaxed">
                <strong className="font-semibold">{i.type}</strong>: {JSON.stringify(i.fields ?? i.field)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Proposed Reasoning & Decision">
        <p className="text-sm leading-relaxed text-neutral-800">
          {doc.decision?.summary || "No automated summary generated."}
        </p>
        {(doc.decision?.proposed_actions ?? []).length > 0 && (
          <div className="mt-4 space-y-2 border-t border-neutral-100 pt-3.5">
            <div className="text-xs font-semibold uppercase tracking-[0.06em] text-neutral-600">
              Proposed Actions
            </div>
            <ul className="divide-y divide-neutral-100 text-xs text-neutral-800">
              {(doc.decision?.proposed_actions ?? []).map((a, n) => (
                <li key={n} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="flex items-center gap-2 font-medium text-neutral-900">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-950" aria-hidden="true" />
                    <span>{a.action}</span>
                  </span>
                  <Pill value={a.risk} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title="Execute Playbook">
        {!me || me.role === "viewer" ? (
          <p className="text-sm text-neutral-600">Viewers cannot run execution playbooks.</p>
        ) : doc.extraction_id && !doc.validation?.needs_review ? (
          <RunPlaybook extractionId={doc.extraction_id} playbooks={playbooks} />
        ) : (
          <Notice tone="warn">
            Resolve validation issues before triggering shop floor execution.
          </Notice>
        )}
      </Card>
    </div>
  );
}
