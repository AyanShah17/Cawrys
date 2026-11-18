// apps/web/app/page.tsx
import React from "react";
import Link from "next/link";
import { StackedBars, TelemetryVelocityBarChart } from "@/components/charts";
import {
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
import { compact, label, num, pct } from "@/lib/format";
import { aiRole } from "@/lib/labels";
import { requireMe, safe, serverGet } from "@/lib/server";
import type { DocSummary, ExecSummary, SystemStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

const DAYS = 14;

const TOOLKIT_BRIDGES = [
  {
    code: "SAP",
    name: "SAP S/4HANA ERP",
    detail: "Inventory Part 100 · FastMCP Bridge",
    status: "Synced",
    meta: "2 min ago",
  },
  {
    code: "PLM",
    name: "Siemens Teamcenter",
    detail: "CAD DWG-4002 Revisions",
    status: "Optimal OEE",
    meta: "Active",
  },
  {
    code: "CNC",
    name: "Industrial FastMCP Spindle",
    detail: "12,000 RPM · Vibration 0.04 mm/s",
    status: "Optimal",
    meta: "Live telemetry",
  },
] as const;

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
  const riskLevel = String(docs?.overrides?.risk_level ?? docs?.risk_level ?? "NORMAL");
  const oeeVal = docs?.overrides?.oee ?? docs?.oee ?? "87.4%";
  const opStatus =
    docs?.overrides?.operational_status ??
    docs?.overrides?.system_health ??
    docs?.operational_status ??
    "Optimal";
  const workOrders = docs?.overrides?.active_work_orders ?? docs?.active_work_orders ?? 14;

  const riskTone: "good" | "warn" | "bad" = /high|critical|severe/i.test(riskLevel)
    ? "bad"
    : /medium|elevated|warn/i.test(riskLevel)
    ? "warn"
    : "good";

  const rawUser = me.email ? me.email.split("@")[0] : "Operator";
  const userName = rawUser.charAt(0).toUpperCase() + rawUser.slice(1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations Overview"
        subtitle={`Signed in as ${userName} (${label(me.role)}) — live production telemetry, connected toolkits, and execution health`}
      >
        {canUpload && (
          <Link href="/documents" className={btnGhostCls}>
            Upload Document
          </Link>
        )}
        <Link href="/chat" className={btnCls}>
          Open Agent Chat
        </Link>
      </PageHeader>

      {/* Operational Notices */}
      {(hasOverrides || needsReview > 0 || awaiting > 0 || down.length > 0) && (
        <div className="space-y-2">
          {hasOverrides && (
            <Notice tone="info">
              Active Chat Overrides: Telemetry targets have been modified via Agent Chat.{" "}
              <Link
                className="ml-1 rounded font-semibold text-neutral-950 underline underline-offset-4 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                href="/chat"
              >
                Manage in Agent Chat
              </Link>
            </Notice>
          )}
          {needsReview > 0 && (
            <Notice tone="warn">
              {needsReview} document{needsReview === 1 ? "" : "s"} need review.{" "}
              <Link
                className="ml-1 rounded font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                href="/documents?status=needs_review"
              >
                Review now
              </Link>
            </Notice>
          )}
          {awaiting > 0 && (
            <Notice tone="warn">
              {awaiting} run{awaiting === 1 ? " is" : "s are"} waiting for approval.{" "}
              {canDecide ? (
                <Link
                  className="ml-1 rounded font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                  href="/approvals"
                >
                  Decide now
                </Link>
              ) : (
                "An approver or admin needs to decide."
              )}
            </Notice>
          )}
          {down.length > 0 && (
            <Notice tone="bad">
              Not healthy: {down.map((s) => s.name).join(", ")}. See System Health below.
            </Notice>
          )}
        </div>
      )}

      {/* 1. TOP KPI METRICS */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="OEE Performance"
          value={String(oeeVal)}
          trend="+6% vs target"
          trendPositive
          hint="Line 1-4 composite efficiency"
        />
        <Stat
          label="Production Target"
          value={String(prodTarget)}
          hint="Active shift target"
        />
        <Stat
          label="Risk Level"
          value={riskLevel}
          tone={riskTone}
          hint={`Operational status: ${String(opStatus)}`}
        />
        <Stat
          label="Active Work Orders"
          value={num(workOrders)}
          hint={rate != null ? `MES Line 4 · ${pct(rate)} run success` : "MES Line 4 active"}
        />
      </div>

      {/* 2. TELEMETRY VELOCITY BAR CHART */}
      <Card>
        <TelemetryVelocityBarChart />
      </Card>

      {/* 3. CONNECTED TOOLKITS & INGESTED CAD SPECS */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Connected Toolkits"
          action={
            <Link
              href="/connectors"
              className="rounded text-xs font-medium text-neutral-800 underline-offset-4 hover:text-neutral-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
            >
              View all
            </Link>
          }
        >
          <ul className="divide-y divide-neutral-100">
            {TOOLKIT_BRIDGES.map((bridge) => (
              <li key={bridge.code} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 font-mono text-xs font-semibold text-neutral-900">
                    {bridge.code}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-neutral-950">{bridge.name}</div>
                    <div className="truncate text-xs text-neutral-600">{bridge.detail}</div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                    {bridge.status}
                  </span>
                  <div className="mt-1 text-[11px] text-neutral-600 tabular-nums">{bridge.meta}</div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs">
            <span className="text-neutral-600">Overall Shopfloor Health</span>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-neutral-950 tabular-nums">
                {String(oeeVal)} OEE Efficiency
              </span>
              <span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden="true" />
            </div>
          </div>
        </Card>

        <Card
          title="Ingested CAD & Document Specs"
          action={
            <Link
              href="/documents"
              className="rounded text-xs font-medium text-neutral-800 underline-offset-4 hover:text-neutral-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
            >
              Upload
            </Link>
          }
        >
          {docs && docs.recent_documents.length > 0 ? (
            <ul className="divide-y divide-neutral-100">
              {docs.recent_documents.slice(0, 4).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/documents/${d.id}`}
                      className="block truncate rounded text-xs font-semibold text-neutral-950 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1"
                    >
                      {d.filename}
                    </Link>
                    <div className="mt-0.5 text-xs text-neutral-600">
                      {d.doc_type ? label(d.doc_type) : "Technical Document"}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <Pill value={d.status} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-8 text-center text-xs text-neutral-600">
              <span>No documents ingested yet.</span>
              {canUpload && (
                <Link
                  href="/documents"
                  className="ml-1.5 rounded font-semibold text-neutral-950 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                >
                  Upload CAD or PDF
                </Link>
              )}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs">
            <span className="text-neutral-600">
              Total documents:{" "}
              <strong className="font-semibold text-neutral-950 tabular-nums">
                {num(docs?.documents.total)}
              </strong>
            </span>
            <Link
              href="/chat"
              className="rounded font-semibold text-neutral-950 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
            >
              Analyze in Chat
            </Link>
          </div>
        </Card>
      </div>

      {/* 4. OPERATIONAL BREAKDOWN */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Documents Processed Per Day">
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
                { key: "ready", name: "Ready", color: "#10b981" },
                { key: "needs_review", name: "Needs review", color: "#f59e0b" },
                { key: "failed", name: "Failed", color: "#f43f5e" },
              ]}
            />
          ) : (
            <Empty>Unavailable</Empty>
          )}
        </Card>
        <Card title="Playbook Executions Per Day">
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
                { key: "succeeded", name: "Succeeded", color: "#10b981" },
                { key: "awaiting_approval", name: "Awaiting approval", color: "#f59e0b" },
                { key: "rejected_or_failed", name: "Rejected / failed", color: "#f43f5e" },
              ]}
            />
          ) : (
            <Empty>Unavailable</Empty>
          )}
        </Card>
      </div>

      {/* 5. SYSTEM HEALTH & AI MODEL TELEMETRY */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="AI Model Telemetry"
          className="lg:col-span-2"
          action={<span className="text-xs font-medium text-neutral-600">Last {DAYS} days</span>}
        >
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
                    <tr key={m.model} className="transition-colors hover:bg-neutral-50/70">
                      <td className={tdCls}>
                        <span className="font-semibold text-neutral-950">{aiRole(m.model)}</span>
                      </td>
                      <td className={`${tdCls} tabular-nums text-neutral-700`}>{num(m.calls)}</td>
                      <td className={`${tdCls} tabular-nums text-neutral-700`}>
                        {compact(m.tokens)}{" "}
                        <span className="text-xs text-neutral-600">
                          ({compact(m.prompt_tokens)} in / {compact(m.completion_tokens)} out)
                        </span>
                      </td>
                      <td className={`${tdCls} tabular-nums text-neutral-700`}>
                        {m.avg_latency_ms ? `${(m.avg_latency_ms / 1000).toFixed(1)}s` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No AI calls recorded in this period yet.</Empty>
          )}
          {docs?.avg_confidence != null && (
            <p className="mt-3 border-t border-neutral-100 pt-3 text-xs text-neutral-600">
              Average extraction confidence:{" "}
              <strong className="font-semibold text-neutral-950 tabular-nums">
                {pct(docs.avg_confidence)}
              </strong>
            </p>
          )}
        </Card>

        <Card
          title="System Health"
          action={
            status && (
              <span
                className={`text-xs font-semibold ${
                  status.ok ? "text-emerald-800" : "text-rose-800"
                }`}
              >
                {status.ok ? "All systems normal" : "Attention needed"}
              </span>
            )
          }
        >
          {status ? (
            <ul className="divide-y divide-neutral-100 text-sm">
              {status.services.map((s) => (
                <li key={s.name} className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                  <span className="flex items-center gap-2.5">
                    <span
                      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                        s.ok ? "bg-emerald-600" : "bg-rose-600"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="text-xs font-medium text-neutral-900">{s.name}</span>
                  </span>
                  <span className="text-xs text-neutral-600 tabular-nums">
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
    </div>
  );
}
