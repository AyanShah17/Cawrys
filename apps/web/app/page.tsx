// apps/web/app/page.tsx
import React from "react";
import Link from "next/link";
import { Distribution, StackedBars } from "@/components/charts";
import { Card, Empty, Notice, PageHeader, Pill, Stat, tableCls, tdCls, thCls } from "@/components/ui/kit";
import { ago, compact, label, num, pct } from "@/lib/format";
import { aiRole } from "@/lib/labels";
import { requireMe, safe, serverGet } from "@/lib/server";
import type { DocSummary, ExecSummary, SystemStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

const DAYS = 14;

export default async function Dashboard() {
  const me = await requireMe();
  const [docs, runs, status] = await Promise.all([
    safe(serverGet<DocSummary>("intelligence", `/v1/dashboard/summary?days=${DAYS}`)),
    safe(serverGet<ExecSummary>("execution", `/v1/dashboard/summary?days=${DAYS}`)),
    safe(serverGet<SystemStatus>("intelligence", "/v1/system/status")),
  ]);

  const canUpload = me.role === "admin" || me.role === "engineer";
  const canDecide = me.role === "admin" || me.role === "approver";
  const needsReview = docs?.documents.by_status.needs_review ?? 0;
  const awaiting = runs?.executions.by_status.awaiting_approval ?? 0;
  const down = status?.services.filter((s) => !s.ok) ?? [];
  const rate = runs?.executions.success_rate ?? null;

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle={`Activity over the last ${DAYS} days`}>
        {canUpload && (
          <Link href="/documents" className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90">
            Upload a document
          </Link>
        )}
      </PageHeader>

      <div className="space-y-2">
        {!docs && !runs && (
          <Notice tone="bad">The services are not responding. Check the system status below, then try again.</Notice>
        )}
        {down.length > 0 && (
          <Notice tone="bad">Not healthy: {down.map((s) => s.name).join(", ")}. See System status below.</Notice>
        )}
        {status?.demo_mode && (
          <Notice tone="info">Demo mode: AI extraction is simulated. Connect an AI provider in the deployment settings for real results.</Notice>
        )}
        {needsReview > 0 && (
          <Notice>
            {needsReview} document{needsReview === 1 ? "" : "s"} need review.{" "}
            <Link className="underline" href="/documents?status=needs_review">Review now</Link>
          </Notice>
        )}
        {awaiting > 0 && (
          <Notice>
            {awaiting} run{awaiting === 1 ? " is" : "s are"} waiting for approval.{" "}
            {canDecide ? (
              <Link className="underline" href="/approvals">Decide now</Link>
            ) : (
              "An approver or admin needs to decide."
            )}
          </Notice>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Documents" value={num(docs?.documents.total)} hint="all time" />
        <Stat label="Needs review" value={num(needsReview)} tone={needsReview ? "warn" : undefined} />
        <Stat label="Awaiting approval" value={num(awaiting)} tone={awaiting ? "warn" : undefined} />
        <Stat label="Runs" value={num(runs?.executions.period_total)} hint={`last ${DAYS} days`} />
        <Stat
          label="Success rate"
          value={pct(rate)}
          tone={rate != null && rate < 0.8 ? "bad" : rate != null ? "good" : undefined}
          hint="completed runs"
        />
        <Stat label="AI tokens" value={compact(docs?.ai.total_tokens)} hint={`${num(docs?.ai.total_calls)} calls`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Documents per day">
          {docs ? (
            <StackedBars
              ariaLabel="Documents processed per day"
              data={docs.documents.per_day.map((d) => ({
                label: d.day,
                ready: d.ready,
                needs_review: d.needs_review,
                failed: d.failed,
              }))}
              series={[
                { key: "ready", name: "Ready", color: "#34d399" },
                { key: "needs_review", name: "Needs review", color: "#fbbf24" },
                { key: "failed", name: "Failed", color: "#f87171" },
              ]}
            />
          ) : (
            <Empty>Unavailable</Empty>
          )}
        </Card>
        <Card title="Playbook runs per day">
          {runs ? (
            <StackedBars
              ariaLabel="Playbook runs per day"
              data={runs.executions.per_day.map((d) => ({
                label: d.day,
                succeeded: d.succeeded,
                awaiting_approval: d.awaiting_approval,
                rejected_or_failed: d.rejected_or_failed,
              }))}
              series={[
                { key: "succeeded", name: "Succeeded", color: "#34d399" },
                { key: "awaiting_approval", name: "Awaiting approval", color: "#fbbf24" },
                { key: "rejected_or_failed", name: "Rejected or failed", color: "#f87171" },
              ]}
            />
          ) : (
            <Empty>Unavailable</Empty>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="AI usage" className="lg:col-span-2" action={<span className="text-xs text-neutral-500">last {DAYS} days</span>}>
          {docs && docs.ai.by_model.length > 0 ? (
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Role</th>
                    <th className={thCls}>Calls</th>
                    <th className={thCls}>Tokens</th>
                    <th className={thCls}>Avg latency</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.ai.by_model.map((m) => (
                    <tr key={m.model}>
                      <td className={tdCls}>{aiRole(m.model)}</td>
                      <td className={`${tdCls} tabular-nums`}>{num(m.calls)}</td>
                      <td className={`${tdCls} tabular-nums`}>
                        {compact(m.tokens)}{" "}
                        <span className="text-xs text-neutral-500">
                          ({compact(m.prompt_tokens)} in / {compact(m.completion_tokens)} out)
                        </span>
                      </td>
                      <td className={`${tdCls} tabular-nums`}>
                        {m.avg_latency_ms ? `${(m.avg_latency_ms / 1000).toFixed(1)}s` : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No AI calls in this period yet.</Empty>
          )}
          {docs?.avg_confidence != null && (
            <p className="mt-3 text-xs text-neutral-500">Average extraction confidence: {pct(docs.avg_confidence)}</p>
          )}
        </Card>

        <Card
          title="System status"
          action={
            status && (
              <span className={`text-xs ${status.ok ? "text-emerald-300" : "text-red-300"}`}>
                {status.ok ? "All systems normal" : "Attention needed"}
              </span>
            )
          }
        >
          {status ? (
            <ul className="space-y-2 text-sm">
              {status.services.map((s) => (
                <li key={s.name} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${s.ok ? "bg-emerald-400" : "bg-red-400"}`}
                      aria-hidden
                    />
                    {s.name}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {s.ok ? s.detail || (s.latency_ms ? `${s.latency_ms} ms` : "ok") : s.detail || "down"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Status unavailable</Empty>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Documents by status">
          {docs && docs.documents.total > 0 ? (
            <Distribution
              ariaLabel="Documents by status"
              items={[
                { label: "Ready", value: docs.documents.by_status.ready ?? 0, color: "#34d399" },
                { label: "Needs review", value: docs.documents.by_status.needs_review ?? 0, color: "#fbbf24" },
                { label: "Failed", value: docs.documents.by_status.failed ?? 0, color: "#f87171" },
                {
                  label: "In progress",
                  value: (docs.documents.by_status.extracting ?? 0) + (docs.documents.by_status.received ?? 0),
                  color: "#38bdf8",
                },
              ]}
            />
          ) : (
            <Empty>No documents yet.</Empty>
          )}
        </Card>

        <Card title="Top playbooks" action={<Link href="/playbooks" className="text-xs text-neutral-400 underline">Manage</Link>}>
          {runs && runs.top_playbooks.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {runs.top_playbooks.map((p) => (
                <li key={p.name ?? "unknown"} className="flex justify-between">
                  <span className="truncate">{p.name ?? "unknown"}</span>
                  <span className="tabular-nums text-neutral-400">{p.runs} runs · {p.succeeded} ok</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No runs yet.</Empty>
          )}
          {runs && (
            <p className="mt-3 text-xs text-neutral-500">
              {runs.playbooks} playbooks · {runs.tools.total} tools
            </p>
          )}
        </Card>

        <Card
          title="Waiting for approval"
          action={
            awaiting > 0 && canDecide ? (
              <Link href="/approvals" className="text-xs text-neutral-400 underline">Open</Link>
            ) : undefined
          }
        >
          {runs && runs.pending_approvals.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {runs.pending_approvals.map((p) => (
                <li key={p.id}>
                  <div className="flex justify-between">
                    <span>{p.playbook}</span>
                    <span className="text-xs text-neutral-500">{ago(p.created_at)}</span>
                  </div>
                  <div className="text-xs text-neutral-500">{p.reason}</div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing waiting.</Empty>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Recent documents" action={<Link href="/documents" className="text-xs text-neutral-400 underline">All documents</Link>}>
          {docs && docs.recent_documents.length > 0 ? (
            <table className={tableCls}>
              <tbody>
                {docs.recent_documents.map((d) => (
                  <tr key={d.id}>
                    <td className={`${tdCls} max-w-[12rem] truncate`}>
                      <Link className="hover:underline" href={`/documents/${d.id}`}>{d.filename}</Link>
                    </td>
                    <td className={`${tdCls} text-xs text-neutral-500`}>{d.doc_type ? label(d.doc_type) : "–"}</td>
                    <td className={tdCls}><Pill value={d.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No documents yet.</Empty>
          )}
        </Card>

        <Card title="Recent activity" action={<Link href="/audit" className="text-xs text-neutral-400 underline">Audit log</Link>}>
          {docs && docs.recent_audit.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {docs.recent_audit.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3">
                  <span>
                    <span className="text-neutral-200">{label(a.event)}</span>{" "}
                    <span className="text-xs text-neutral-500">by {a.actor}</span>
                  </span>
                  <span className="shrink-0 text-xs text-neutral-500">{ago(a.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No activity yet.</Empty>
          )}
        </Card>
      </div>
    </div>
  );
}
