// apps/web/app/page.tsx
import React from "react";
import Link from "next/link";
import { Distribution, StackedBars, TelemetryVelocityBarChart } from "@/components/charts";
import {
  Badge,
  Card,
  Empty,
  Notice,
  Pill,
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
  const riskLevel = docs?.overrides?.risk_level ?? docs?.risk_level ?? "NORMAL";
  const oeeVal = docs?.overrides?.oee ?? docs?.oee ?? "87.4%";
  const opStatus = docs?.overrides?.operational_status ?? docs?.overrides?.system_health ?? docs?.operational_status ?? "Optimal";
  const workOrders = docs?.overrides?.active_work_orders ?? docs?.active_work_orders ?? 14;

  const rawUser = me.email ? me.email.split("@")[0] : "James";
  const userName = rawUser.charAt(0).toUpperCase() + rawUser.slice(1);

  return (
    <div className="space-y-6">
      {/* Top Notices (if any) */}
      {(hasOverrides || needsReview > 0 || awaiting > 0 || down.length > 0) && (
        <div className="space-y-2">
          {hasOverrides && (
            <Notice tone="info">
              Active Chat Overrides: Telemetry targets have been modified via Agent Chat.{" "}
              <Link className="underline font-semibold text-neutral-900 hover:text-black ml-1" href="/chat">
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
          {down.length > 0 && (
            <Notice tone="bad">Not healthy: {down.map((s) => s.name).join(", ")}. See System status below.</Notice>
          )}
        </div>
      )}

      {/* 1. TOP STAT CARDS IN GRID (Matching Reference Image) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Greeting & OEE Performance */}
        <div className="bg-white rounded-3xl p-6 border border-neutral-200/60 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[170px]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-neutral-900">
                Hello, {userName}!
              </h2>
              <div className="text-xs font-medium text-neutral-500 uppercase tracking-wider mt-1">
                OEE Performance
              </div>
            </div>
            <button
              type="button"
              className="h-8 w-8 rounded-full bg-neutral-950 text-white flex items-center justify-center shrink-0 shadow-sm hover:scale-105 transition-transform"
              title="OEE Efficiency Action"
              aria-label="OEE Efficiency Action"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-4 w-4">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </button>
          </div>
          <div className="mt-4 flex items-baseline justify-between gap-2">
            <div className="text-3xl font-bold tracking-tight text-neutral-900 tabular-nums">
              {String(oeeVal)}
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 text-xs font-semibold border border-emerald-200">
              +6% vs target
            </span>
          </div>
        </div>

        {/* Card 2: Production Target */}
        <div className="bg-white rounded-3xl p-6 border border-neutral-200/60 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[170px]">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
              Production Target
            </div>
            <button
              type="button"
              className="h-8 w-8 rounded-full bg-neutral-950 text-white flex items-center justify-center shrink-0 shadow-sm hover:scale-105 transition-transform"
              title="Target Settings"
              aria-label="Target Settings"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <circle cx="12" cy="12" r="10" />
                <path d="m10 15 5-3-5-3v6Z" />
              </svg>
            </button>
          </div>
          <div className="mt-4 flex items-baseline justify-between gap-2">
            <div className="text-3xl font-bold tracking-tight text-neutral-900 tabular-nums">
              {String(prodTarget)}
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 text-neutral-700 px-2.5 py-0.5 text-xs font-medium border border-neutral-200">
              Active
            </span>
          </div>
        </div>

        {/* Card 3: Operational Risk */}
        <div className="bg-white rounded-3xl p-6 border border-neutral-200/60 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[170px]">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
              Risk Level
            </div>
            <button
              type="button"
              className="h-8 w-8 rounded-full bg-neutral-950 text-white flex items-center justify-center shrink-0 shadow-sm hover:scale-105 transition-transform"
              title="Risk Assessment"
              aria-label="Risk Assessment"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
              </svg>
            </button>
          </div>
          <div className="mt-4 flex items-baseline justify-between gap-2">
            <div className="text-3xl font-bold tracking-tight text-neutral-900 tabular-nums">
              {String(riskLevel)}
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 text-xs font-semibold border border-emerald-200">
              {String(opStatus)}
            </span>
          </div>
        </div>

        {/* Card 4: Active Work Orders */}
        <div className="bg-white rounded-3xl p-6 border border-neutral-200/60 shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[170px]">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
              Active Work Orders
            </div>
            <button
              type="button"
              className="h-8 w-8 rounded-full bg-neutral-950 text-white flex items-center justify-center shrink-0 shadow-sm hover:scale-105 transition-transform"
              title="MES Orders"
              aria-label="MES Orders"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>
            </button>
          </div>
          <div className="mt-4 flex items-baseline justify-between gap-2">
            <div className="text-3xl font-bold tracking-tight text-neutral-900 tabular-nums">
              {num(workOrders)}
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 text-neutral-700 px-2.5 py-0.5 text-xs font-medium border border-neutral-200">
              MES Line 4
            </span>
          </div>
        </div>
      </div>

      {/* 2. TELEMETRY BAR CHART (Matching Reference Image) */}
      <div className="bg-white rounded-3xl p-6 border border-neutral-200/60 shadow-sm">
        <TelemetryVelocityBarChart />
      </div>

      {/* 3. SECONDARY CARDS (Connected Toolkits & Ingested CAD Specs) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Secondary Card 1: Connected Toolkits & Recent Events (Matching Ventas in reference image) */}
        <div className="bg-white rounded-3xl p-6 border border-neutral-200/60 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100 mb-4">
              <div>
                <h3 className="text-base font-semibold text-neutral-900 tracking-tight">Connected Toolkits</h3>
                <p className="text-xs text-neutral-500">Live operational bridges & telemetry connectors</p>
              </div>
              <Link href="/connectors" className="text-xs font-medium text-neutral-900 hover:underline">
                View all &rarr;
              </Link>
            </div>

            <div className="space-y-3.5">
              <div className="flex items-center justify-between p-2 rounded-2xl hover:bg-neutral-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-neutral-950 text-white flex items-center justify-center font-bold text-xs shadow-sm">
                    SAP
                  </div>
                  <div>
                    <div className="font-semibold text-neutral-900 text-xs">SAP S/4HANA ERP</div>
                    <div className="text-[11px] text-neutral-500">Inventory Part 100 &middot; FastMCP Bridge</div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-xs font-bold border border-emerald-200">
                    Synced
                  </span>
                  <div className="text-[10px] text-neutral-400 mt-0.5">2 min ago</div>
                </div>
              </div>

              <div className="flex items-center justify-between p-2 rounded-2xl hover:bg-neutral-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-neutral-950 text-white flex items-center justify-center font-bold text-xs shadow-sm">
                    PLM
                  </div>
                  <div>
                    <div className="font-semibold text-neutral-900 text-xs">Siemens Teamcenter</div>
                    <div className="text-[11px] text-neutral-500">CAD DWG-4002 Revisions</div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-xs font-bold border border-emerald-200">
                    Optimal OEE
                  </span>
                  <div className="text-[10px] text-neutral-400 mt-0.5">Active</div>
                </div>
              </div>

              <div className="flex items-center justify-between p-2 rounded-2xl hover:bg-neutral-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-neutral-950 text-white flex items-center justify-center font-bold text-xs shadow-sm">
                    CNC
                  </div>
                  <div>
                    <div className="font-semibold text-neutral-900 text-xs">Industrial FastMCP Spindle</div>
                    <div className="text-[11px] text-neutral-500">12,000 RPM &middot; Vibration 0.04 mm/s</div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-xs font-bold border border-emerald-200">
                    Optimal
                  </span>
                  <div className="text-[10px] text-neutral-400 mt-0.5">Live telemetry</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between text-xs">
            <span className="text-neutral-500">Overall Shopfloor Health</span>
            <div className="flex items-center gap-2">
              <span className="font-bold text-neutral-900">87.4% OEE Efficiency</span>
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
            </div>
          </div>
        </div>

        {/* Secondary Card 2: Ingested CAD & Document Specs */}
        <div className="bg-white rounded-3xl p-6 border border-neutral-200/60 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100 mb-4">
              <div>
                <h3 className="text-base font-semibold text-neutral-900 tracking-tight">Ingested CAD & Document Specs</h3>
                <p className="text-xs text-neutral-500">Extracted engineering parameters & drawings</p>
              </div>
              <Link href="/documents" className="text-xs font-medium text-neutral-900 hover:underline">
                Upload &rarr;
              </Link>
            </div>

            {docs && docs.recent_documents.length > 0 ? (
              <div className="space-y-3">
                {docs.recent_documents.slice(0, 4).map((d) => (
                  <div key={d.id} className="flex items-center justify-between p-2 rounded-2xl hover:bg-neutral-50 transition-colors">
                    <div className="min-w-0 flex-1 pr-3">
                      <Link
                        href={`/documents/${d.id}`}
                        className="font-semibold text-xs text-neutral-900 hover:underline truncate block"
                      >
                        {d.filename}
                      </Link>
                      <div className="text-[11px] text-neutral-500 mt-0.5">
                        {d.doc_type ? label(d.doc_type) : "Technical Document"}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Pill value={d.status} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-neutral-500">
                <span>No documents ingested yet.</span>{" "}
                {canUpload && (
                  <Link href="/documents" className="text-neutral-900 font-semibold underline ml-1">
                    Upload CAD or PDF
                  </Link>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between text-xs">
            <span className="text-neutral-500">Total documents: <strong className="text-neutral-900">{num(docs?.documents.total)}</strong></span>
            <Link href="/chat" className="text-neutral-900 font-semibold hover:underline">
              Analyze in Chat &rarr;
            </Link>
          </div>
        </div>
      </div>

      {/* 4. OPERATIONAL BREAKDOWN (Documents & Runs per day) */}
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

      {/* 5. SYSTEM STATUS & AI USAGE */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="AI Model Telemetry" className="lg:col-span-2" action={<span className="text-xs text-neutral-500 font-medium">last {DAYS} days</span>}>
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
                    <tr key={m.model} className="hover:bg-neutral-50 transition-colors">
                      <td className={tdCls}>
                        <span className="font-semibold text-neutral-900">{aiRole(m.model)}</span>
                      </td>
                      <td className={`${tdCls} tabular-nums text-neutral-700`}>{num(m.calls)}</td>
                      <td className={`${tdCls} tabular-nums text-neutral-700`}>
                        {compact(m.tokens)}{" "}
                        <span className="text-xs text-neutral-400">
                          ({compact(m.prompt_tokens)} in / {compact(m.completion_tokens)} out)
                        </span>
                      </td>
                      <td className={`${tdCls} tabular-nums text-neutral-700`}>
                        {m.avg_latency_ms ? `${(m.avg_latency_ms / 1000).toFixed(1)}s` : "–"}
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
            <p className="mt-3 text-xs text-neutral-500">Average extraction confidence: <strong className="text-neutral-900">{pct(docs.avg_confidence)}</strong></p>
          )}
        </Card>

        <Card
          title="System Health"
          action={
            status && (
              <span className={`text-xs font-semibold ${status.ok ? "text-emerald-700" : "text-rose-700"}`}>
                {status.ok ? "All systems normal" : "Attention needed"}
              </span>
            )
          }
        >
          {status ? (
            <ul className="space-y-2 text-sm">
              {status.services.map((s) => (
                <li key={s.name} className="flex items-center justify-between rounded-xl p-2 hover:bg-neutral-50 transition-colors">
                  <span className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${s.ok ? "bg-emerald-500" : "bg-rose-500"}`}
                      aria-hidden
                    />
                    <span className="text-neutral-800 font-medium text-xs">{s.name}</span>
                  </span>
                  <span className="text-xs text-neutral-500 tabular-nums">
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
