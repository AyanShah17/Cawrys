// apps/web/app/page.tsx
import React from "react";
import Link from "next/link";
import { Distribution, StackedBars } from "@/components/charts";
import {
  Badge,
  Card,
  Empty,
  Notice,
  PageHeader,
  Pill,
  Stat,
  btnCls,
  btnGhostCls,
  tableCls,
  tdCls,
  thCls,
} from "@/components/ui/kit";
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

  const hasOverrides = Boolean(docs?.overrides && Object.keys(docs.overrides).length > 0);
  const prodTarget = docs?.overrides?.production_target ?? docs?.production_target ?? "1,000 units";
  const riskLevel = docs?.overrides?.risk_level ?? docs?.risk_level ?? "LOW";
  const oeeVal = docs?.overrides?.oee ?? docs?.oee ?? "92.4%";
  const opStatus = docs?.overrides?.operational_status ?? docs?.overrides?.system_health ?? docs?.operational_status ?? "Optimal";
  const workOrders = docs?.overrides?.active_work_orders ?? docs?.active_work_orders ?? 34;

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle={`Operational overview and metrics over the last ${DAYS} days`}>
        <div className="flex items-center gap-2">
          <Link
            href="/chat"
            className={btnGhostCls}
          >
            <span className="flex items-center gap-1.5">
              <span>Agent Chat</span>
              <span className="rounded-full bg-brand/20 px-1.5 py-0.2 text-[10px] font-semibold text-brand">
                AI
              </span>
            </span>
          </Link>
          {canUpload && (
            <Link href="/documents" className={btnCls}>
              Upload a document
            </Link>
          )}
        </div>
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
        {hasOverrides && (
          <Notice tone="info">
            Active Chat Overrides: Telemetry targets have been modified via Agent Chat.{" "}
            <Link className="underline font-medium text-brand hover:text-brand/80 ml-1" href="/chat">
              Manage in Agent Chat &rarr;
            </Link>
          </Notice>
        )}
        {needsReview > 0 && (
          <Notice tone="warn">
            {needsReview} document{needsReview === 1 ? "" : "s"} need review.{" "}
            <Link className="underline font-medium ml-1" href="/documents?status=needs_review">Review now &rarr;</Link>
          </Notice>
        )}
        {awaiting > 0 && (
          <Notice tone="warn">
            {awaiting} run{awaiting === 1 ? " is" : "s are"} waiting for approval.{" "}
            {canDecide ? (
              <Link className="underline font-medium ml-1" href="/approvals">Decide now &rarr;</Link>
            ) : (
              "An approver or admin needs to decide."
            )}
          </Notice>
        )}
      </div>

      {/* Live Operational Targets & Dynamic Telemetry */}
      <div className="rounded-xl border border-white/10 bg-gradient-to-r from-white/[0.03] via-white/[0.015] to-transparent p-5 backdrop-blur-sm shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
              Operational Telemetry &amp; Live Targets
            </span>
            {hasOverrides && (
              <Badge variant="default" className="text-[11px] py-0 px-2 font-semibold">
                ⚡ Modified via Agent Chat
              </Badge>
            )}
          </div>
          <Link href="/chat" className="text-xs font-medium text-brand hover:underline flex items-center gap-1">
            <span>Adjust via Agent Chat</span>
            <span>&rarr;</span>
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Production Target"
            value={String(prodTarget)}
            hint={hasOverrides && docs?.overrides?.production_target ? "custom target" : "shift quota"}
          />
          <Stat
            label="Operational Risk"
            value={String(riskLevel)}
            tone={riskLevel === "LOW" ? "good" : riskLevel === "HIGH" || riskLevel === "CRITICAL" ? "bad" : "warn"}
            hint="safety & compliance"
          />
          <Stat
            label="OEE Efficiency"
            value={String(oeeVal)}
            tone={parseFloat(String(oeeVal)) >= 90 ? "good" : undefined}
            hint="equipment effectiveness"
          />
          <Stat
            label="Machine Telemetry"
            value={String(opStatus)}
            tone={opStatus.toLowerCase() === "optimal" ? "good" : opStatus.toLowerCase() === "degraded" ? "bad" : "warn"}
            hint="shop floor status"
          />
          <Stat
            label="Active Work Orders"
            value={num(workOrders)}
            hint="in execution"
          />
        </div>
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

      <div className="grid gap-5 lg:grid-cols-2">
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

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="AI usage" className="lg:col-span-2" action={<span className="text-xs text-neutral-400 font-medium">last {DAYS} days</span>}>
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
                    <tr key={m.model} className="hover:bg-white/[0.02] transition-colors">
                      <td className={tdCls}>
                        <span className="font-medium text-white">{aiRole(m.model)}</span>
                      </td>
                      <td className={`${tdCls} tabular-nums text-neutral-300`}>{num(m.calls)}</td>
                      <td className={`${tdCls} tabular-nums text-neutral-300`}>
                        {compact(m.tokens)}{" "}
                        <span className="text-xs text-neutral-500">
                          ({compact(m.prompt_tokens)} in / {compact(m.completion_tokens)} out)
                        </span>
                      </td>
                      <td className={`${tdCls} tabular-nums text-neutral-300`}>
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
            <p className="mt-3 text-xs text-neutral-400">Average extraction confidence: <strong className="text-white">{pct(docs.avg_confidence)}</strong></p>
          )}
        </Card>

        <Card
          title="System status"
          action={
            status && (
              <span className={`text-xs font-medium ${status.ok ? "text-emerald-300" : "text-red-300"}`}>
                {status.ok ? "All systems normal" : "Attention needed"}
              </span>
            )
          }
        >
          {status ? (
            <ul className="space-y-2.5 text-sm">
              {status.services.map((s) => (
                <li key={s.name} className="flex items-center justify-between rounded-lg p-1.5 hover:bg-white/[0.02] transition-colors">
                  <span className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${s.ok ? "bg-emerald-400" : "bg-red-400"}`}
                      aria-hidden
                    />
                    <span className="text-neutral-200 font-medium text-xs">{s.name}</span>
                  </span>
                  <span className="text-xs text-neutral-400 tabular-nums">
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

      <div className="grid gap-5 lg:grid-cols-3">
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

        <Card title="Top playbooks" action={<Link href="/playbooks" className="text-xs text-neutral-400 hover:text-white underline">Manage</Link>}>
          {runs && runs.top_playbooks.length > 0 ? (
            <ul className="space-y-2.5 text-sm">
              {runs.top_playbooks.map((p) => (
                <li key={p.name ?? "unknown"} className="flex justify-between items-center rounded-lg p-1 hover:bg-white/[0.02]">
                  <span className="truncate text-neutral-200 text-xs font-medium">{p.name ?? "unknown"}</span>
                  <span className="tabular-nums text-xs text-neutral-400">{p.runs} runs · <span className="text-emerald-400">{p.succeeded} ok</span></span>
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
              <Link href="/approvals" className="text-xs text-neutral-400 hover:text-white underline">Open</Link>
            ) : undefined
          }
        >
          {runs && runs.pending_approvals.length > 0 ? (
            <ul className="space-y-2.5 text-sm">
              {runs.pending_approvals.map((p) => (
                <li key={p.id} className="rounded-lg p-1.5 hover:bg-white/[0.02]">
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-200 font-medium text-xs">{p.playbook}</span>
                    <span className="text-[11px] text-neutral-500">{ago(p.created_at)}</span>
                  </div>
                  <div className="text-xs text-neutral-400 mt-0.5">{p.reason}</div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing waiting.</Empty>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Recent documents" action={<Link href="/documents" className="text-xs text-neutral-400 hover:text-white underline">All documents</Link>}>
          {docs && docs.recent_documents.length > 0 ? (
            <table className={tableCls}>
              <tbody>
                {docs.recent_documents.map((d) => (
                  <tr key={d.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className={`${tdCls} max-w-[12rem] truncate`}>
                      <Link className="font-medium text-white hover:underline hover:text-brand transition-colors" href={`/documents/${d.id}`}>
                        {d.filename}
                      </Link>
                    </td>
                    <td className={`${tdCls} text-xs text-neutral-400`}>{d.doc_type ? label(d.doc_type) : "–"}</td>
                    <td className={tdCls}><Pill value={d.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No documents yet.</Empty>
          )}
        </Card>

        <Card title="Recent activity" action={<Link href="/audit" className="text-xs text-neutral-400 hover:text-white underline">Audit log</Link>}>
          {docs && docs.recent_audit.length > 0 ? (
            <ul className="space-y-2.5 text-sm">
              {docs.recent_audit.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 rounded-lg p-1 hover:bg-white/[0.02]">
                  <div>
                    <span className="text-xs font-medium text-neutral-200">{label(a.event)}</span>{" "}
                    <span className="text-xs text-neutral-500">by {a.actor}</span>
                  </div>
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
