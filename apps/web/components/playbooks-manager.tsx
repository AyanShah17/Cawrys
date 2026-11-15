// apps/web/components/playbooks-manager.tsx
"use client";

import React, { useState } from "react";
import Link from "next/link";
import { API, getJSON, post } from "@/lib/api";
import { ago } from "@/lib/format";
import { Button, Card, Pill, inputCls } from "@/components/ui/kit";

export type PlaybookStep = {
  tool: string;
  params?: Record<string, unknown>;
};

export type Playbook = {
  name: string;
  version: number;
  steps: PlaybookStep[];
};

export type ExecStepResult = {
  step?: number;
  tool: string;
  result?: unknown;
};

export type Exec = {
  id: string;
  status: string;
  created_at: string;
  extraction_id?: string | null;
  result?: {
    reason?: string;
    playbook?: string;
    inputs?: Record<string, unknown>;
    results?: ExecStepResult[];
    [key: string]: unknown;
  } | null;
};

export interface PlaybooksManagerProps {
  initialPlaybooks: Playbook[];
  initialExecutions: Exec[];
  role: "admin" | "engineer" | "approver" | "viewer" | string;
}

export function PlaybooksManager({
  initialPlaybooks,
  initialExecutions,
  role,
}: PlaybooksManagerProps) {
  const [playbooks, setPlaybooks] = useState<Playbook[]>(initialPlaybooks ?? []);
  const [executions, setExecutions] = useState<Exec[]>(initialExecutions ?? []);

  // Run Playbook Modal state
  const [runModalPlaybook, setRunModalPlaybook] = useState<Playbook | null>(null);
  const [runInputs, setRunInputs] = useState({
    drawing_id: "DWG-2026-X1",
    material: "6061-T6 Aluminum",
    quantity: "25",
  });
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{
    execution_id: string;
    status: string;
    reason?: string;
    results?: ExecStepResult[];
  } | null>(null);

  // New Playbook Modal state
  const [isNewPlaybookOpen, setIsNewPlaybookOpen] = useState(false);
  const [newPlaybookName, setNewPlaybookName] = useState("");
  const [newPlaybookSteps, setNewPlaybookSteps] = useState(
    "sap_check_inventory, fastmcp_inspect_tolerances, quote_vendor"
  );

  // Register Tool Modal state
  const [isRegisterToolOpen, setIsRegisterToolOpen] = useState(false);
  const [newTool, setNewTool] = useState({
    name: "fastmcp_cmm_inspection",
    description: "Automated CMM dimensional validation protocol",
    connector: "industrial_mcp",
    risk: "medium",
    input_schema: JSON.stringify(
      {
        type: "object",
        properties: {
          drawing_id: { type: "string" },
          tolerance_standard: { type: "string", default: "ISO 2768-mK" },
        },
        required: ["drawing_id"],
      },
      null,
      2
    ),
  });

  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Expandable execution details
  const [expandedExecId, setExpandedExecId] = useState<string | null>(null);
  const [copiedExecId, setCopiedExecId] = useState<string | null>(null);

  const canAuthor = role === "admin" || role === "engineer";
  const canRun = role !== "viewer";

  const refreshPlaybooks = async () => {
    try {
      const fresh = await getJSON<Playbook[]>(`${API.execution}/v1/playbooks`);
      if (fresh) setPlaybooks(fresh);
    } catch {
      // ignore
    }
  };

  const refreshExecutions = async () => {
    try {
      const fresh = await getJSON<Exec[]>(`${API.execution}/v1/executions`);
      if (fresh) setExecutions(fresh);
    } catch {
      // ignore
    }
  };

  const openRunModal = (p: Playbook) => {
    setRunModalPlaybook(p);
    setRunError(null);
    setRunResult(null);
    setRunInputs({
      drawing_id: `DWG-${Math.floor(1000 + Math.random() * 9000)}`,
      material: "6061-T6 Aluminum",
      quantity: "10",
    });
  };

  const handleRunSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!runModalPlaybook) return;

    setRunBusy(true);
    setRunError(null);
    setRunResult(null);

    try {
      const payload = {
        playbook: runModalPlaybook.name,
        inputs: {
          drawing_id: runInputs.drawing_id.trim() || undefined,
          material: runInputs.material.trim() || undefined,
          quantity: Number(runInputs.quantity) || 1,
        },
      };

      const res = await post<{
        execution_id: string;
        status: string;
        reason?: string;
        results?: ExecStepResult[];
      }>(`${API.execution}/v1/executions`, payload);

      setRunResult(res);
      await refreshExecutions();
    } catch (err: any) {
      setRunError(err?.message || "Execution request failed");
    } finally {
      setRunBusy(false);
    }
  };

  const handleCreatePlaybook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaybookName.trim()) return;

    setModalBusy(true);
    setModalError(null);

    try {
      const tools = newPlaybookSteps
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (tools.length === 0) {
        throw new Error("Please specify at least one tool step");
      }

      const steps = tools.map((tool) => ({ tool }));
      await post(`${API.execution}/v1/playbooks`, {
        name: newPlaybookName.trim(),
        steps,
      });

      setIsNewPlaybookOpen(false);
      setNewPlaybookName("");
      setNewPlaybookSteps("");
      await refreshPlaybooks();
    } catch (err: any) {
      setModalError(err?.message || "Failed to create playbook");
    } finally {
      setModalBusy(false);
    }
  };

  const handleRegisterTool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTool.name.trim()) return;

    setModalBusy(true);
    setModalError(null);

    try {
      let parsedSchema: any;
      try {
        parsedSchema = JSON.parse(newTool.input_schema);
      } catch {
        throw new Error("Input Schema must be valid JSON");
      }

      await post(`${API.execution}/v1/tools`, {
        name: newTool.name.trim(),
        description: newTool.description.trim() || undefined,
        connector: newTool.connector.trim() || "log",
        risk: newTool.risk || "medium",
        input_schema: parsedSchema,
      });

      setIsRegisterToolOpen(false);
      setNewTool({
        name: "",
        description: "",
        connector: "log",
        risk: "medium",
        input_schema: JSON.stringify(
          {
            type: "object",
            properties: {
              drawing_id: { type: "string" },
            },
          },
          null,
          2
        ),
      });
      await refreshPlaybooks();
    } catch (err: any) {
      setModalError(err?.message || "Failed to register tool");
    } finally {
      setModalBusy(false);
    }
  };

  const handleCopyJson = (exec: Exec) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(JSON.stringify(exec, null, 2));
      setCopiedExecId(exec.id);
      setTimeout(() => setCopiedExecId(null), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Available Playbooks Card */}
        <Card
          title="Available Playbooks"
          action={
            canAuthor ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalError(null);
                    setIsNewPlaybookOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-neutral-950 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-neutral-800 active:scale-[0.98]"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>New Playbook</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setModalError(null);
                    setIsRegisterToolOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50 hover:text-neutral-900 active:scale-[0.98]"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                  <span>Register Tool</span>
                </button>
              </div>
            ) : undefined
          }
        >
          {playbooks.length === 0 ? (
            <div className="py-8 text-center text-xs text-neutral-400">
              No playbooks registered yet.
            </div>
          ) : (
            <ul className="space-y-3.5 text-sm">
              {playbooks.map((p) => (
                <li
                  key={p.name}
                  className="group rounded-2xl border border-neutral-200/80 bg-neutral-50/50 p-4 transition-all duration-200 hover:border-neutral-300 hover:bg-white hover:shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-neutral-900 tracking-tight">{p.name}</span>
                      <span className="rounded-full border border-neutral-200/80 bg-neutral-100 px-2 py-0.5 font-mono text-[10px] text-neutral-600">
                        v{p.version}
                      </span>
                    </div>

                    {canRun && (
                      <button
                        type="button"
                        onClick={() => openRunModal(p)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-neutral-950 px-3.5 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-neutral-800 active:scale-[0.98]"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        <span>Run Playbook</span>
                      </button>
                    )}
                  </div>

                  {/* Steps with clean arrow icons */}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500 font-mono">
                    {p.steps.map((s, idx) => (
                      <React.Fragment key={idx}>
                        <span className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-neutral-800 shadow-xs">
                          {s.tool}
                        </span>
                        {idx < p.steps.length - 1 && (
                          <svg className="h-3 w-3 text-neutral-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M5 12h14M12 5l7 7-7 7" />
                          </svg>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Recent Executions Card */}
        <Card
          title="Recent Executions"
          action={
            <button
              type="button"
              onClick={refreshExecutions}
              className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 transition"
              title="Refresh execution history"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" />
              </svg>
              <span>Refresh</span>
            </button>
          }
        >
          {executions.length === 0 ? (
            <div className="py-8 text-center text-xs text-neutral-400">
              No execution runs recorded yet.
            </div>
          ) : (
            <ul className="space-y-2.5 text-sm">
              {executions.slice(0, 15).map((e) => {
                const isExpanded = expandedExecId === e.id;
                const isCopied = copiedExecId === e.id;
                const rawResult = e.result || {};
                const playbookName =
                  rawResult.playbook ||
                  (rawResult.results && rawResult.results.length > 0
                    ? `${rawResult.results.length}-step pipeline`
                    : "Standard Pipeline");

                return (
                  <li
                    key={e.id}
                    className="rounded-2xl border border-neutral-200/70 bg-neutral-50/50 p-3.5 transition-all duration-200 hover:border-neutral-300 hover:bg-white hover:shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-neutral-900 tracking-tight text-xs">
                          {playbookName}
                        </span>
                        <span className="font-mono text-[11px] text-neutral-500">
                          {e.id.slice(0, 8)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-neutral-400">
                          {ago(e.created_at)}
                        </span>
                        <Pill value={e.status} />
                        <button
                          type="button"
                          onClick={() => setExpandedExecId(isExpanded ? null : e.id)}
                          className="rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition"
                          title={isExpanded ? "Collapse details" : "Expand details"}
                          aria-label={isExpanded ? "Collapse details" : "Expand details"}
                        >
                          <svg
                            className={`h-3.5 w-3.5 transform transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Expandable JSON / Step Inspector */}
                    {isExpanded && (
                      <div className="mt-3.5 space-y-3 border-t border-neutral-200/70 pt-3 text-xs">
                        {rawResult.reason && (
                          <div className="rounded-xl border border-neutral-200 bg-white p-2.5 text-neutral-700">
                            <span className="font-semibold text-neutral-900">Reason / Summary:</span>{" "}
                            {rawResult.reason}
                          </div>
                        )}

                        {rawResult.inputs && Object.keys(rawResult.inputs).length > 0 && (
                          <div className="rounded-xl border border-neutral-200 bg-white p-3 space-y-1.5">
                            <div className="font-semibold text-neutral-800 text-[11px] uppercase tracking-wider">
                              Run Inputs
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                              {Object.entries(rawResult.inputs).map(([k, v]) => (
                                <div key={k} className="truncate">
                                  <span className="text-neutral-500">{k}:</span>{" "}
                                  <span className="font-mono text-neutral-800">{String(v)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {rawResult.results && rawResult.results.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="font-semibold text-neutral-800 text-[11px] uppercase tracking-wider">
                              Executed Steps ({rawResult.results.length})
                            </div>
                            <div className="space-y-1">
                              {rawResult.results.map((r, i) => (
                                <div
                                  key={i}
                                  className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px]"
                                >
                                  <span className="font-mono text-neutral-800">
                                    Step {r.step ?? i + 1}: {r.tool}
                                  </span>
                                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700 font-medium border border-emerald-200">
                                    Done
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-neutral-700 text-[11px] uppercase tracking-wider">
                              Raw Result JSON
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyJson(e)}
                              className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[10px] text-neutral-600 hover:bg-neutral-50 transition shadow-xs"
                            >
                              {isCopied ? "Copied" : "Copy JSON"}
                            </button>
                          </div>
                          <pre className="max-h-48 overflow-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-3 font-mono text-[11px] text-emerald-400 leading-relaxed shadow-inner">
                            {JSON.stringify(e, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* Run Playbook Modal */}
      {runModalPlaybook && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/40 backdrop-blur-sm duration-200"
          onClick={() => {
            if (!runBusy) setRunModalPlaybook(null);
          }}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-neutral-200 bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col text-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-4">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-neutral-900">
                  Run Playbook: {runModalPlaybook.name}
                </h3>
                <p className="mt-0.5 text-xs text-neutral-500">
                  Configure run parameters and execute tool pipeline.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setRunModalPlaybook(null)}
                disabled={runBusy}
                className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 transition disabled:opacity-40"
                aria-label="Close modal"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Live Result Banner */}
            {runResult && (
              <div>
                {runResult.status === "succeeded" && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Pipeline Execution Succeeded</span>
                      <Pill value="succeeded" />
                    </div>
                    <div className="text-emerald-700 font-mono text-[11px]">Run ID: {runResult.execution_id}</div>
                    <div>{runResult.reason || "All pipeline steps completed successfully."}</div>
                  </div>
                )}

                {runResult.status === "awaiting_approval" && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-medium text-amber-900 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Execution Awaiting Human Approval</span>
                      <Pill value="awaiting_approval" />
                    </div>
                    <div className="text-amber-800 font-mono text-[11px]">Run ID: {runResult.execution_id}</div>
                    <p className="text-amber-800 leading-relaxed">
                      {runResult.reason || "Policy requires authorized engineer or approver sign-off before proceeding."}
                    </p>
                    <div>
                      <Link
                        href="/approvals"
                        className="inline-flex items-center gap-1.5 rounded-full bg-neutral-950 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-neutral-800 transition"
                      >
                        <span>Review in Approvals</span>
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                      </Link>
                    </div>
                  </div>
                )}

                {runResult.status === "rejected" && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Execution Rejected</span>
                      <Pill value="rejected" />
                    </div>
                    <div className="text-rose-700 font-mono text-[11px]">Run ID: {runResult.execution_id}</div>
                    <div>{runResult.reason || "Pipeline policy check denied execution."}</div>
                  </div>
                )}
              </div>
            )}

            {runError && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800">
                {runError}
              </div>
            )}

            <form onSubmit={handleRunSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Drawing ID
                </label>
                <input
                  type="text"
                  required
                  value={runInputs.drawing_id}
                  onChange={(e) => setRunInputs({ ...runInputs, drawing_id: e.target.value })}
                  placeholder="e.g. DWG-2026-X1"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Material Specification
                </label>
                <input
                  type="text"
                  required
                  value={runInputs.material}
                  onChange={(e) => setRunInputs({ ...runInputs, material: e.target.value })}
                  placeholder="e.g. 6061-T6 Aluminum"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Quantity
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={runInputs.quantity}
                  onChange={(e) => setRunInputs({ ...runInputs, quantity: e.target.value })}
                  placeholder="e.g. 25"
                  className={inputCls}
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-neutral-100 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRunModalPlaybook(null)}
                  disabled={runBusy}
                >
                  Close
                </Button>
                <Button type="submit" disabled={runBusy}>
                  {runBusy ? "Executing..." : "Execute Playbook"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Playbook Modal */}
      {isNewPlaybookOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/40 backdrop-blur-sm duration-200"
          onClick={() => {
            if (!modalBusy) setIsNewPlaybookOpen(false);
          }}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-neutral-200 bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col text-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-4">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-neutral-900">
                  Create New Playbook
                </h3>
                <p className="mt-0.5 text-xs text-neutral-500">
                  Compose a repeatable multi-step FastMCP industrial automation pipeline.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsNewPlaybookOpen(false)}
                disabled={modalBusy}
                className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 transition disabled:opacity-40"
                aria-label="Close modal"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {modalError && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800">
                {modalError}
              </div>
            )}

            <form onSubmit={handleCreatePlaybook} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Playbook Name
                </label>
                <input
                  type="text"
                  required
                  value={newPlaybookName}
                  onChange={(e) => setNewPlaybookName(e.target.value)}
                  placeholder="e.g. fastmcp_tolerance_pipeline"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Pipeline Steps (Comma or Line Separated Tool Names)
                </label>
                <textarea
                  required
                  rows={3}
                  value={newPlaybookSteps}
                  onChange={(e) => setNewPlaybookSteps(e.target.value)}
                  placeholder="sap_check_inventory, fastmcp_inspect_tolerances, quote_vendor"
                  className={`${inputCls} font-mono text-xs`}
                />
                <p className="mt-1 text-[11px] text-neutral-400">
                  Steps execute sequentially with policy validation at each stage.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-neutral-100 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsNewPlaybookOpen(false)}
                  disabled={modalBusy}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={modalBusy}>
                  {modalBusy ? "Saving..." : "Save Playbook"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Register Tool Modal */}
      {isRegisterToolOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/40 backdrop-blur-sm duration-200"
          onClick={() => {
            if (!modalBusy) setIsRegisterToolOpen(false);
          }}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-neutral-200 bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col text-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-4">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-neutral-900">
                  Register FastMCP Tool
                </h3>
                <p className="mt-0.5 text-xs text-neutral-500">
                  Add an executable action connector with input schema &amp; risk governance.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsRegisterToolOpen(false)}
                disabled={modalBusy}
                className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 transition disabled:opacity-40"
                aria-label="Close modal"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {modalError && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800">
                {modalError}
              </div>
            )}

            <form onSubmit={handleRegisterTool} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Tool Name
                </label>
                <input
                  type="text"
                  required
                  value={newTool.name}
                  onChange={(e) => setNewTool({ ...newTool, name: e.target.value })}
                  placeholder="e.g. fastmcp_tolerance_check"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={newTool.description}
                  onChange={(e) => setNewTool({ ...newTool, description: e.target.value })}
                  placeholder="Validate geometric tolerances against ISO standards"
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Connector
                  </label>
                  <select
                    value={newTool.connector}
                    onChange={(e) => setNewTool({ ...newTool, connector: e.target.value })}
                    className={inputCls}
                  >
                    <option value="industrial_mcp">Industrial FastMCP</option>
                    <option value="log">Log / Mock Connector</option>
                    <option value="sap_s4hana">SAP S/4HANA</option>
                    <option value="siemens_xcelerator">Siemens Xcelerator</option>
                    <option value="rockwell_factorytalk">Rockwell FactoryTalk</option>
                    <option value="python">Python Sandbox</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1">
                    Risk Classification
                  </label>
                  <select
                    value={newTool.risk}
                    onChange={(e) => setNewTool({ ...newTool, risk: e.target.value })}
                    className={inputCls}
                  >
                    <option value="low">Low (Auto-Execute)</option>
                    <option value="medium">Medium (Standard)</option>
                    <option value="high">High (Requires Approver)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Input Schema (JSON Schema)
                </label>
                <textarea
                  required
                  rows={4}
                  value={newTool.input_schema}
                  onChange={(e) => setNewTool({ ...newTool, input_schema: e.target.value })}
                  className={`${inputCls} font-mono text-xs`}
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-neutral-100 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsRegisterToolOpen(false)}
                  disabled={modalBusy}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={modalBusy}>
                  {modalBusy ? "Registering..." : "Register Tool"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
