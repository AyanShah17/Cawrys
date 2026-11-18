// apps/web/components/playbooks-manager.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { API, del, getJSON, post, put } from "@/lib/api";
import { ago } from "@/lib/format";
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Pill,
  inputCls,
} from "@/components/ui/kit";
import { IconBolt, IconCheck } from "@/components/ui/icons";
import { loadLiteLLMConfig } from "./litellm-modal";

export type PlaybookStep = {
  tool: string;
  params?: Record<string, unknown>;
};

export type Playbook = {
  name: string;
  version: number;
  steps: PlaybookStep[];
};

export type RegisteredTool = {
  name: string;
  description?: string | null;
  connector?: string;
  risk?: "low" | "medium" | "high" | string;
  input_schema?: Record<string, unknown>;
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
  initialTools?: RegisteredTool[];
  role: "admin" | "engineer" | "approver" | "viewer" | string;
}

const AI_QUICK_PROMPTS = [
  "Add quality_check step before schedule_production",
  "Add slack_notify at end",
  "Set schedule_production quantity to 250",
  "Remove last step",
  "Create playbook quality-gate with quality_check, notify_team",
];

function extractInputVars(steps: PlaybookStep[]): string[] {
  const vars = new Set<string>();
  const scan = (val: unknown) => {
    if (typeof val === "string") {
      const matches = val.matchAll(/\$inputs\.([a-zA-Z0-9_]+)/g);
      for (const m of matches) {
        if (m[1]) vars.add(m[1]);
      }
    } else if (val && typeof val === "object") {
      for (const v of Object.values(val as Record<string, unknown>)) {
        scan(v);
      }
    }
  };
  for (const st of steps) scan(st.params);
  return Array.from(vars);
}

function getStepLiveState(
  stepIdx: number,
  stepTool: string,
  exec: Exec | null
): {
  state: "idle" | "succeeded" | "awaiting_approval" | "rejected" | "skipped";
  label: string;
  output?: unknown;
} {
  if (!exec) return { state: "idle", label: "Ready" };
  const results = exec.result?.results || [];
  const matched = results.find(
    (r) => r.step === stepIdx || (r.step === undefined && r.tool === stepTool)
  );
  if (matched) {
    return { state: "succeeded", label: "Executed", output: matched.result };
  }
  const executedCount = results.length;
  if (stepIdx === executedCount) {
    if (exec.status === "awaiting_approval") {
      return { state: "awaiting_approval", label: "Awaiting Approval" };
    }
    if (exec.status === "rejected" || exec.status === "failed") {
      return { state: "rejected", label: "Blocked / Rejected" };
    }
  }
  return { state: "skipped", label: "Pending" };
}

export function PlaybooksManager({
  initialPlaybooks,
  initialExecutions,
  initialTools = [],
  role,
}: PlaybooksManagerProps) {
  const [playbooks, setPlaybooks] = useState<Playbook[]>(initialPlaybooks ?? []);
  const [executions, setExecutions] = useState<Exec[]>(initialExecutions ?? []);
  const [tools, setTools] = useState<RegisteredTool[]>(initialTools ?? []);

  // Canvas selection state
  const [selectedPlaybookName, setSelectedPlaybookName] = useState<string>(
    initialPlaybooks?.[0]?.name || ""
  );
  const [selectedExecId, setSelectedExecId] = useState<string>(() => {
    const firstPb = initialPlaybooks?.[0]?.name;
    const latest = (initialExecutions || []).find(
      (ex) => !firstPb || ex.result?.playbook === firstPb
    );
    return latest?.id || "";
  });

  // Node / Step Inspector state on Canvas
  const [editingStepIdx, setEditingStepIdx] = useState<number | null>(null);
  const [insertAtIdx, setInsertAtIdx] = useState<number | null>(null);
  const [draftTool, setDraftTool] = useState<string>("");
  const [draftCustomTool, setDraftCustomTool] = useState<string>("");
  const [draftParamsJson, setDraftParamsJson] = useState<string>("{}");
  const [canvasBusy, setCanvasBusy] = useState(false);
  const [canvasNotice, setCanvasNotice] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  // Confirm delete playbook inline toggle
  const [confirmDeletePb, setConfirmDeletePb] = useState(false);

  // AI Pipeline Copilot state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

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
    "erp_lookup_inventory, quality_check, notify_team"
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

  const activePlaybook = useMemo(
    () =>
      playbooks.find((p) => p.name === selectedPlaybookName) ||
      playbooks[0] ||
      null,
    [playbooks, selectedPlaybookName]
  );

  const matchingExecutions = useMemo(() => {
    if (!activePlaybook) return [];
    return executions.filter(
      (e) =>
        e.result?.playbook === activePlaybook.name ||
        (!e.result?.playbook && executions.length > 0)
    );
  }, [executions, activePlaybook]);

  const inspectedExec = useMemo(
    () => executions.find((e) => e.id === selectedExecId) || null,
    [executions, selectedExecId]
  );

  const toolLookup = useMemo(() => {
    const map: Record<string, RegisteredTool> = {};
    for (const t of tools) map[t.name] = t;
    return map;
  }, [tools]);

  // Keep active selection valid when playbooks change
  useEffect(() => {
    if (!activePlaybook && playbooks.length > 0) {
      setSelectedPlaybookName(playbooks[0].name);
    }
  }, [activePlaybook, playbooks]);

  const refreshTools = async () => {
    try {
      const fresh = await getJSON<RegisteredTool[]>(`${API.execution}/v1/tools`);
      if (fresh) setTools(fresh);
    } catch {
      // ignore
    }
  };

  const refreshPlaybooks = async (preferredName?: string) => {
    try {
      const fresh = await getJSON<Playbook[]>(`${API.execution}/v1/playbooks`);
      if (fresh) {
        setPlaybooks(fresh);
        if (preferredName && fresh.some((p) => p.name === preferredName)) {
          setSelectedPlaybookName(preferredName);
        } else if (fresh.length > 0 && !fresh.some((p) => p.name === selectedPlaybookName)) {
          setSelectedPlaybookName(fresh[0].name);
        }
      }
      await refreshTools();
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

  const selectPlaybookOnCanvas = (name: string) => {
    setSelectedPlaybookName(name);
    setEditingStepIdx(null);
    setInsertAtIdx(null);
    setConfirmDeletePb(false);
    setCanvasNotice(null);
    const latest = executions.find((e) => e.result?.playbook === name);
    setSelectedExecId(latest?.id || "");
  };

  const openStepInspector = (idx: number) => {
    if (!activePlaybook) return;
    const step = activePlaybook.steps[idx];
    if (!step) return;
    setInsertAtIdx(null);
    setEditingStepIdx(idx);
    const inRegistered = tools.some((t) => t.name === step.tool);
    setDraftTool(inRegistered ? step.tool : "__custom__");
    setDraftCustomTool(inRegistered ? "" : step.tool);
    setDraftParamsJson(JSON.stringify(step.params || {}, null, 2));
    setCanvasNotice(null);
  };

  const openInsertStep = (atIdx: number) => {
    if (!canAuthor) return;
    setEditingStepIdx(null);
    setInsertAtIdx(atIdx);
    const fallbackTool = tools[0]?.name || "erp_lookup_inventory";
    setDraftTool(fallbackTool);
    setDraftCustomTool("");
    setDraftParamsJson(
      fallbackTool === "erp_lookup_inventory"
        ? JSON.stringify({ material: "$inputs.material" }, null, 2)
        : "{}"
    );
    setCanvasNotice(null);
  };

  const persistCanvasSteps = async (pbName: string, nextSteps: PlaybookStep[], okMsg: string) => {
    setCanvasBusy(true);
    setCanvasNotice(null);
    try {
      const res = await put<{ ok: boolean; playbook: Playbook; playbooks: Playbook[] }>(
        `${API.execution}/v1/playbooks/${encodeURIComponent(pbName)}`,
        { steps: nextSteps }
      );
      if (res.playbooks) setPlaybooks(res.playbooks);
      else await refreshPlaybooks(pbName);
      await refreshTools();
      setEditingStepIdx(null);
      setInsertAtIdx(null);
      setCanvasNotice({ kind: "ok", text: okMsg });
    } catch (err: any) {
      setCanvasNotice({ kind: "err", text: err?.message || "Failed to update playbook pipeline" });
    } finally {
      setCanvasBusy(false);
    }
  };

  const handleSaveStepInspector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePlaybook || !canAuthor) return;

    const chosenTool = (draftTool === "__custom__" ? draftCustomTool : draftTool).trim();
    if (!chosenTool) {
      setCanvasNotice({ kind: "err", text: "Please specify a valid tool name." });
      return;
    }

    let parsedParams: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(draftParamsJson || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Parameters must be a JSON object");
      }
      parsedParams = parsed;
    } catch (err: any) {
      setCanvasNotice({ kind: "err", text: err?.message || "Parameters must be valid JSON" });
      return;
    }

    const nextSteps = activePlaybook.steps.map((s) => ({ ...s }));
    if (insertAtIdx !== null) {
      nextSteps.splice(insertAtIdx, 0, { tool: chosenTool, params: parsedParams });
      await persistCanvasSteps(
        activePlaybook.name,
        nextSteps,
        `Inserted step '${chosenTool}' at position ${insertAtIdx + 1}.`
      );
    } else if (editingStepIdx !== null && nextSteps[editingStepIdx]) {
      nextSteps[editingStepIdx] = { tool: chosenTool, params: parsedParams };
      await persistCanvasSteps(
        activePlaybook.name,
        nextSteps,
        `Updated step ${editingStepIdx + 1} ('${chosenTool}').`
      );
    }
  };

  const handleDeleteStep = async (idx: number) => {
    if (!activePlaybook || !canAuthor) return;
    if (activePlaybook.steps.length <= 1) {
      setCanvasNotice({
        kind: "err",
        text: "A playbook requires at least one step. Use 'Delete Playbook' to remove the entire pipeline.",
      });
      return;
    }
    const target = activePlaybook.steps[idx];
    const nextSteps = activePlaybook.steps.filter((_, i) => i !== idx);
    await persistCanvasSteps(
      activePlaybook.name,
      nextSteps,
      `Deleted step ${idx + 1} ('${target.tool}').`
    );
  };

  const handleMoveStep = async (idx: number, delta: -1 | 1) => {
    if (!activePlaybook || !canAuthor) return;
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= activePlaybook.steps.length) return;
    const nextSteps = [...activePlaybook.steps];
    const [moved] = nextSteps.splice(idx, 1);
    nextSteps.splice(newIdx, 0, moved);
    await persistCanvasSteps(
      activePlaybook.name,
      nextSteps,
      `Moved '${moved.tool}' to step ${newIdx + 1}.`
    );
  };

  const handleDeletePlaybook = async () => {
    if (!activePlaybook || !canAuthor) return;
    setCanvasBusy(true);
    setCanvasNotice(null);
    const deletedName = activePlaybook.name;
    try {
      const res = await del<{ ok: boolean; deleted: string; playbooks: Playbook[] }>(
        `${API.execution}/v1/playbooks/${encodeURIComponent(deletedName)}`
      );
      const nextList = res.playbooks || [];
      setPlaybooks(nextList);
      setConfirmDeletePb(false);
      setEditingStepIdx(null);
      setInsertAtIdx(null);
      setSelectedPlaybookName(nextList[0]?.name || "");
      setSelectedExecId("");
      setCanvasNotice({ kind: "ok", text: `Deleted playbook '${deletedName}'.` });
    } catch (err: any) {
      setCanvasNotice({ kind: "err", text: err?.message || "Could not delete playbook" });
    } finally {
      setCanvasBusy(false);
    }
  };

  const handleAiEditSubmit = async (promptOverride?: string) => {
    const promptToRun = (promptOverride ?? aiPrompt).trim();
    if (!promptToRun || aiBusy || !canAuthor) return;

    setAiBusy(true);
    setCanvasNotice(null);
    try {
      const modelCfg = loadLiteLLMConfig();
      const res = await post<{
        ok: boolean;
        action: string;
        message: string;
        playbook: Playbook | null;
        playbooks: Playbook[];
      }>(`${API.execution}/v1/playbooks/ai`, {
        prompt: promptToRun,
        playbook_name: activePlaybook?.name || undefined,
        provider: modelCfg.provider,
        model: modelCfg.model,
        api_key: modelCfg.apiKey || undefined,
        base_url: modelCfg.baseUrl || undefined,
      });

      if (res.playbooks) {
        setPlaybooks(res.playbooks);
      }
      if (res.playbook?.name) {
        setSelectedPlaybookName(res.playbook.name);
      } else if (res.playbooks && res.playbooks.length > 0) {
        setSelectedPlaybookName(res.playbooks[0].name);
      }
      setEditingStepIdx(null);
      setInsertAtIdx(null);
      if (!promptOverride) setAiPrompt("");
      await refreshTools();
      setCanvasNotice({ kind: "ok", text: res.message });
    } catch (err: any) {
      setCanvasNotice({ kind: "err", text: err?.message || "AI playbook edit failed" });
    } finally {
      setAiBusy(false);
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
      setSelectedPlaybookName(runModalPlaybook.name);
      setSelectedExecId(res.execution_id);
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
      const stepTools = newPlaybookSteps
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (stepTools.length === 0) {
        throw new Error("Please specify at least one tool step");
      }

      const steps = stepTools.map((tool) => ({ tool }));
      const createdName = newPlaybookName.trim();
      await post(`${API.execution}/v1/playbooks`, {
        name: createdName,
        steps,
      });

      setIsNewPlaybookOpen(false);
      setNewPlaybookName("");
      setNewPlaybookSteps("");
      await refreshPlaybooks(createdName);
      setCanvasNotice({ kind: "ok", text: `Created playbook '${createdName}'.` });
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

  const detectedVars = activePlaybook ? extractInputVars(activePlaybook.steps) : [];

  return (
    <div className="space-y-6">
      {/* Interactive Playbook Execution Pipeline Canvas */}
      <Card
        title="Playbook Pipeline Canvas"
        action={
          activePlaybook && canRun ? (
            <Button type="button" size="sm" onClick={() => openRunModal(activePlaybook)}>
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span>Run Pipeline</span>
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-4">
          {/* Playbook Tabs + Run Telemetry Overlay Selector */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Playbooks">
              {playbooks.map((p) => {
                const isSelected = activePlaybook?.name === p.name;
                return (
                  <button
                    key={p.name}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => selectPlaybookOnCanvas(p.name)}
                    className={`inline-flex h-8 items-center gap-2 rounded-full border px-3.5 text-xs font-medium transition-colors duration-150 ease-out-quart active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 ${
                      isSelected
                        ? "border-neutral-950 bg-neutral-950 text-white"
                        : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-300 hover:bg-neutral-50"
                    }`}
                  >
                    <span>{p.name}</span>
                    <span
                      className={`font-mono text-[11px] tabular-nums ${
                        isSelected ? "text-neutral-300" : "text-neutral-600"
                      }`}
                    >
                      v{p.version} · {p.steps.length}
                    </span>
                  </button>
                );
              })}
            </div>

            {activePlaybook && (
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="exec-overlay-select" className="text-xs font-medium text-neutral-600">
                  Overlay
                </label>
                <select
                  id="exec-overlay-select"
                  value={selectedExecId}
                  onChange={(e) => setSelectedExecId(e.target.value)}
                  className="h-8 rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-800 transition-colors focus-visible:border-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
                >
                  <option value="">Design Mode (no run overlay)</option>
                  {matchingExecutions.slice(0, 12).map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.id.slice(0, 8)} · {ex.status} · {ago(ex.created_at)}
                    </option>
                  ))}
                </select>

                {canAuthor && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openInsertStep(activePlaybook.steps.length)}
                      disabled={canvasBusy}
                    >
                      + Add Step
                    </Button>

                    {confirmDeletePb ? (
                      <div className="inline-flex h-8 items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5">
                        <button
                          type="button"
                          onClick={handleDeletePlaybook}
                          disabled={canvasBusy}
                          className="rounded-full bg-rose-600 px-2.5 py-0.5 text-xs font-semibold text-white transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1"
                        >
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeletePb(false)}
                          className="rounded-full px-2 py-0.5 text-xs font-medium text-neutral-700 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => setConfirmDeletePb(true)}
                        disabled={canvasBusy}
                      >
                        Delete Playbook
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* AI Pipeline Copilot Bar */}
          {canAuthor && (
            <div className="space-y-2.5 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <IconBolt
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-700"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    aria-label="AI pipeline edit instruction"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAiEditSubmit();
                      }
                    }}
                    placeholder="Ask AI to edit pipeline: 'Add quality_check before schedule_production', 'Set quantity to 250'..."
                    className={`${inputCls} pl-9 text-xs`}
                    disabled={aiBusy}
                  />
                </div>
                <Button
                  type="button"
                  onClick={() => handleAiEditSubmit()}
                  disabled={aiBusy || !aiPrompt.trim()}
                  className="shrink-0 text-xs font-semibold"
                >
                  {aiBusy ? "Applying..." : "Apply AI Edit"}
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-medium text-neutral-600">
                  Quick AI Actions:
                </span>
                {AI_QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={aiBusy}
                    onClick={() => handleAiEditSubmit(q)}
                    className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs text-neutral-700 transition-colors duration-150 ease-out-quart hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1 disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Status Banner */}
          {canvasNotice && (
            <div
              role="status"
              className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs font-medium ${
                canvasNotice.kind === "ok"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              <div className="flex items-center gap-2">
                {canvasNotice.kind === "ok" && (
                  <IconCheck className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                )}
                <span>{canvasNotice.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setCanvasNotice(null)}
                className="rounded px-1.5 py-0.5 text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Dot-Grid Visual Pipeline Canvas */}
          {!activePlaybook ? (
            <div className="rounded-xl border border-dashed border-neutral-300 bg-[#f8f9fb] py-12 text-center text-xs text-neutral-600">
              No playbook selected. Create one below or use the AI Copilot above to build a workflow.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-[#f8f9fb] bg-[radial-gradient(#d4d4d8_1px,transparent_1px)] p-4 [background-size:16px_16px] sm:p-5">
              <div className="flex min-w-max items-center gap-2 py-1">
                {/* Trigger Start Node */}
                <div className="w-48 shrink-0 rounded-2xl border border-neutral-200 bg-white p-3.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="rounded-full bg-neutral-950 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-white">
                      TRIGGER
                    </span>
                    <span className="text-[11px] font-medium text-neutral-600">Inputs</span>
                  </div>
                  <div className="text-xs font-semibold text-neutral-950">
                    Manual / Document Run
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {detectedVars.length > 0 ? (
                      detectedVars.map((v) => (
                        <span
                          key={v}
                          className="rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-[11px] text-neutral-800"
                        >
                          ${v}
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-neutral-600">No $inputs required</span>
                    )}
                  </div>
                </div>

                {/* Connector + Insert Slot 0 */}
                <div className="flex shrink-0 items-center gap-1">
                  <div className="h-[2px] w-4 bg-neutral-300" />
                  {canAuthor && (
                    <button
                      type="button"
                      onClick={() => openInsertStep(0)}
                      title="Insert step at beginning"
                      aria-label="Insert step at beginning"
                      className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1 ${
                        insertAtIdx === 0
                          ? "border-neutral-950 bg-neutral-950 text-white"
                          : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-950 hover:text-neutral-950"
                      }`}
                    >
                      +
                    </button>
                  )}
                  <svg className="h-3.5 w-3.5 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </div>

                {/* Pipeline Step Nodes */}
                {activePlaybook.steps.map((step, idx) => {
                  const isEditing = editingStepIdx === idx;
                  const meta = toolLookup[step.tool];
                  const risk = meta?.risk || "low";
                  const connector = meta?.connector || "log";
                  const live = getStepLiveState(idx, step.tool, inspectedExec);
                  const paramEntries = Object.entries(step.params || {});

                  const liveBorder = isEditing
                    ? "border-neutral-950 ring-2 ring-neutral-950/15"
                    : live.state === "succeeded"
                    ? "border-emerald-300"
                    : live.state === "awaiting_approval"
                    ? "border-amber-300"
                    : live.state === "rejected"
                    ? "border-rose-300"
                    : "border-neutral-200 hover:border-neutral-400";

                  const liveBadgeCls =
                    live.state === "succeeded"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : live.state === "awaiting_approval"
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : live.state === "rejected"
                      ? "border-rose-200 bg-rose-50 text-rose-800"
                      : "border-neutral-200 bg-neutral-100 text-neutral-800";

                  const riskBadgeCls =
                    risk === "high"
                      ? "border-rose-200 bg-rose-50 text-rose-800"
                      : risk === "medium"
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-neutral-200 bg-neutral-100 text-neutral-800";

                  return (
                    <React.Fragment key={`${step.tool}-${idx}`}>
                      <div
                        onClick={() => openStepInspector(idx)}
                        role="button"
                        tabIndex={0}
                        aria-label={`Inspect step ${idx + 1}: ${step.tool}`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openStepInspector(idx);
                          }
                        }}
                        className={`group relative w-64 shrink-0 cursor-pointer rounded-2xl border bg-white p-3.5 transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 ${liveBorder}`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-1.5">
                          <span className="font-mono text-[11px] font-semibold text-neutral-600 tabular-nums">
                            STEP {String(idx + 1).padStart(2, "0")}
                          </span>
                          <div className="flex items-center gap-1">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${riskBadgeCls}`}
                            >
                              {risk}
                            </span>
                            {inspectedExec && (
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${liveBadgeCls}`}
                              >
                                {live.label}
                              </span>
                            )}
                          </div>
                        </div>

                        <div
                          className="truncate font-mono text-xs font-semibold text-neutral-950"
                          title={step.tool}
                        >
                          {step.tool}
                        </div>
                        <div className="mt-0.5 text-[11px] text-neutral-600">
                          connector: <span className="font-mono text-neutral-800">{connector}</span>
                        </div>

                        {/* Parameter Key-Value Table */}
                        <div className="mt-2.5">
                          {paramEntries.length === 0 ? (
                            <div className="text-[11px] text-neutral-600">Default inputs</div>
                          ) : (
                            <div className="divide-y divide-neutral-100 rounded-lg border border-neutral-200/80 bg-neutral-50/70 px-2.5 py-0.5">
                              {paramEntries.slice(0, 3).map(([k, v]) => (
                                <div
                                  key={k}
                                  className="flex items-center justify-between gap-2 py-1 text-[11px]"
                                >
                                  <span className="truncate font-mono text-neutral-600">{k}</span>
                                  <span className="max-w-[125px] truncate font-mono font-medium text-neutral-900 tabular-nums">
                                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          {paramEntries.length > 3 && (
                            <div className="mt-1 text-[11px] text-neutral-600 tabular-nums">
                              +{paramEntries.length - 3} more param(s)
                            </div>
                          )}
                        </div>

                        {/* Node Quick Actions */}
                        {canAuthor && (
                          <div
                            className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-2.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={idx === 0 || canvasBusy}
                                onClick={() => handleMoveStep(idx, -1)}
                                className="flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 transition-colors hover:bg-neutral-50 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:opacity-30"
                                title="Move step left"
                                aria-label={`Move step ${idx + 1} left`}
                              >
                                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                                  <path d="M19 12H5M12 19l-7-7 7-7" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                disabled={idx === activePlaybook.steps.length - 1 || canvasBusy}
                                onClick={() => handleMoveStep(idx, 1)}
                                className="flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 transition-colors hover:bg-neutral-50 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:opacity-30"
                                title="Move step right"
                                aria-label={`Move step ${idx + 1} right`}
                              >
                                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                                  <path d="M5 12h14M12 5l7 7-7 7" />
                                </svg>
                              </button>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openStepInspector(idx)}
                                className="rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-800 transition-colors hover:bg-neutral-50 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={canvasBusy}
                                onClick={() => handleDeleteStep(idx)}
                                className="rounded-md border border-rose-200 bg-white px-2 py-0.5 text-[11px] font-medium text-rose-800 transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 disabled:opacity-40"
                                title="Delete step"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Edge Connector & Edge Insert Button */}
                      <div className="flex shrink-0 items-center gap-1">
                        <div className="h-[2px] w-4 bg-neutral-300" />
                        {canAuthor && (
                          <button
                            type="button"
                            onClick={() => openInsertStep(idx + 1)}
                            title={`Insert step after ${step.tool}`}
                            aria-label={`Insert step after ${step.tool}`}
                            className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1 ${
                              insertAtIdx === idx + 1
                                ? "border-neutral-950 bg-neutral-950 text-white"
                                : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-950 hover:text-neutral-950"
                            }`}
                          >
                            +
                          </button>
                        )}
                        <svg className="h-3.5 w-3.5 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                      </div>
                    </React.Fragment>
                  );
                })}

                {/* Output / Completion Node */}
                <div className="w-48 shrink-0 rounded-2xl border border-neutral-200 bg-white p-3.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-neutral-800">
                      OUTPUT
                    </span>
                    {inspectedExec && <Pill value={inspectedExec.status} />}
                  </div>
                  <div className="text-xs font-semibold text-neutral-950">
                    Pipeline Completion
                  </div>
                  <div className="mt-1.5 text-[11px] leading-relaxed text-neutral-600">
                    {inspectedExec
                      ? inspectedExec.result?.reason ||
                        `Run ${inspectedExec.id.slice(0, 8)} (${inspectedExec.status})`
                      : `${activePlaybook.steps.length} configured stage(s)`}
                  </div>
                  {inspectedExec?.status === "awaiting_approval" && (
                    <Link
                      href="/approvals"
                      className="mt-2.5 inline-flex h-7 items-center gap-1 rounded-full bg-neutral-950 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
                    >
                      Approve Run
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Inline Node / Step Editor Inspector */}
          {activePlaybook && (editingStepIdx !== null || insertAtIdx !== null) && (
            <form
              onSubmit={handleSaveStepInspector}
              className="space-y-4 rounded-xl border border-neutral-200 bg-neutral-50/70 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200/80 pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-neutral-950">
                    {insertAtIdx !== null
                      ? `Insert New Step at Position ${insertAtIdx + 1}`
                      : `Inspect & Edit Step ${(editingStepIdx ?? 0) + 1}`}
                  </h3>
                  <p className="text-xs text-neutral-600">
                    Assign a registered FastMCP tool or enter a custom tool identifier and JSON parameters.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingStepIdx(null);
                    setInsertAtIdx(null);
                  }}
                >
                  Close Inspector
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="inspector-step-tool"
                      className="mb-1.5 block text-xs font-semibold text-neutral-800"
                    >
                      Step Tool
                    </label>
                    <select
                      id="inspector-step-tool"
                      value={draftTool}
                      onChange={(e) => setDraftTool(e.target.value)}
                      disabled={!canAuthor || canvasBusy}
                      className={inputCls}
                    >
                      {tools.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name} ({t.risk || "low"})
                        </option>
                      ))}
                      <option value="__custom__">+ Custom / New Tool Name...</option>
                    </select>
                  </div>

                  {draftTool === "__custom__" && (
                    <div>
                      <label
                        htmlFor="inspector-custom-tool"
                        className="mb-1.5 block text-xs font-semibold text-neutral-800"
                      >
                        Custom Tool Identifier
                      </label>
                      <input
                        id="inspector-custom-tool"
                        type="text"
                        required
                        value={draftCustomTool}
                        onChange={(e) => setDraftCustomTool(e.target.value)}
                        placeholder="e.g. quality_check"
                        className={`${inputCls} font-mono text-xs`}
                      />
                    </div>
                  )}

                  {editingStepIdx !== null && inspectedExec && (
                    <div className="rounded-xl border border-neutral-200 bg-white p-3 text-xs">
                      <div className="mb-1.5 font-semibold text-neutral-900">
                        Execution Output (Run {inspectedExec.id.slice(0, 8)})
                      </div>
                      <pre className="max-h-32 overflow-auto font-mono text-[11px] text-neutral-800">
                        {JSON.stringify(
                          getStepLiveState(
                            editingStepIdx,
                            activePlaybook.steps[editingStepIdx]?.tool || "",
                            inspectedExec
                          ),
                          null,
                          2
                        )}
                      </pre>
                    </div>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="inspector-step-params"
                    className="mb-1.5 block text-xs font-semibold text-neutral-800"
                  >
                    Step Parameters (JSON Object)
                  </label>
                  <textarea
                    id="inspector-step-params"
                    rows={5}
                    value={draftParamsJson}
                    onChange={(e) => setDraftParamsJson(e.target.value)}
                    disabled={!canAuthor || canvasBusy}
                    className={`${inputCls} h-auto py-2 font-mono text-xs`}
                  />
                </div>
              </div>

              {canAuthor && (
                <div className="flex items-center justify-end gap-2 pt-1">
                  {editingStepIdx !== null && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDeleteStep(editingStepIdx)}
                      disabled={canvasBusy}
                    >
                      Delete Step
                    </Button>
                  )}
                  <Button type="submit" size="sm" disabled={canvasBusy}>
                    {canvasBusy
                      ? "Saving..."
                      : insertAtIdx !== null
                      ? "Insert Step"
                      : "Save Step Changes"}
                  </Button>
                </div>
              )}
            </form>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Available Playbooks Card */}
        <Card
          title="Available Playbooks"
          action={
            canAuthor ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setModalError(null);
                    setIsNewPlaybookOpen(true);
                  }}
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>New Playbook</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setModalError(null);
                    setIsRegisterToolOpen(true);
                  }}
                >
                  <span>Register Tool</span>
                </Button>
              </div>
            ) : undefined
          }
        >
          {playbooks.length === 0 ? (
            <div className="py-8 text-center text-xs text-neutral-600">
              No playbooks registered yet.
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {playbooks.map((p) => {
                const isActive = activePlaybook?.name === p.name;
                return (
                  <li
                    key={p.name}
                    className={`py-4 first:pt-0 last:pb-0 ${
                      isActive ? "bg-neutral-50/70 -mx-3 px-3 rounded-xl" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold tracking-tight text-neutral-950">
                          {p.name}
                        </span>
                        <span className="rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5 font-mono text-[11px] font-medium text-neutral-800 tabular-nums">
                          v{p.version}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant={isActive ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => selectPlaybookOnCanvas(p.name)}
                        >
                          {isActive ? "Active on Canvas" : "Open Canvas"}
                        </Button>
                        {canRun && (
                          <Button type="button" size="sm" onClick={() => openRunModal(p)}>
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                              <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                            <span>Run Playbook</span>
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5 font-mono text-xs text-neutral-600">
                      {p.steps.map((s, idx) => (
                        <React.Fragment key={idx}>
                          <span className="rounded-md border border-neutral-200 bg-white px-2.5 py-0.5 text-neutral-800">
                            {s.tool}
                          </span>
                          {idx < p.steps.length - 1 && (
                            <svg className="h-3 w-3 shrink-0 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                              <path d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Recent Executions Card */}
        <Card
          title="Recent Executions"
          action={
            <Button type="button" variant="ghost" size="sm" onClick={refreshExecutions}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" />
              </svg>
              <span>Refresh</span>
            </Button>
          }
        >
          {executions.length === 0 ? (
            <div className="py-8 text-center text-xs text-neutral-600">
              No execution runs recorded yet.
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm">
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
                  <li key={e.id} className="py-3.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold tracking-tight text-neutral-950">
                          {playbookName}
                        </span>
                        <span className="font-mono text-xs text-neutral-600 tabular-nums">
                          {e.id.slice(0, 8)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {rawResult.playbook && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPlaybookName(rawResult.playbook!);
                              setSelectedExecId(e.id);
                            }}
                            className="h-7 rounded-full border border-neutral-200 bg-white px-2.5 text-xs font-medium text-neutral-800 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1"
                          >
                            Trace
                          </button>
                        )}
                        <span className="text-xs text-neutral-600 tabular-nums">
                          {ago(e.created_at)}
                        </span>
                        <Pill value={e.status} />
                        <button
                          type="button"
                          onClick={() => setExpandedExecId(isExpanded ? null : e.id)}
                          className="rounded-full p-1 text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                          title={isExpanded ? "Collapse details" : "Expand details"}
                          aria-label={isExpanded ? "Collapse details" : "Expand details"}
                          aria-expanded={isExpanded}
                        >
                          <svg
                            className={`h-3.5 w-3.5 transition-transform duration-150 ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            aria-hidden="true"
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Expandable JSON / Step Inspector */}
                    {isExpanded && (
                      <div className="mt-3 space-y-3 border-t border-neutral-100 pt-3 text-xs">
                        {rawResult.reason && (
                          <div className="text-neutral-700">
                            <span className="font-semibold text-neutral-950">Reason:</span>{" "}
                            {rawResult.reason}
                          </div>
                        )}

                        {rawResult.inputs && Object.keys(rawResult.inputs).length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-xs font-semibold uppercase tracking-[0.06em] text-neutral-600">
                              Run Inputs
                            </div>
                            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                              {Object.entries(rawResult.inputs).map(([k, v]) => (
                                <div key={k} className="truncate">
                                  <span className="text-neutral-600">{k}:</span>{" "}
                                  <span className="font-mono text-neutral-900">{String(v)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {rawResult.results && rawResult.results.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-xs font-semibold uppercase tracking-[0.06em] text-neutral-600">
                              Executed Steps ({rawResult.results.length})
                            </div>
                            <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-neutral-50/70">
                              {rawResult.results.map((r, i) => (
                                <div
                                  key={i}
                                  className="flex items-center justify-between px-3 py-2 text-xs"
                                >
                                  <span className="font-mono text-neutral-900">
                                    Step {r.step ?? i + 1}: {r.tool}
                                  </span>
                                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                                    Done
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-neutral-600">
                              Raw Result JSON
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyJson(e)}
                              className="rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                            >
                              {isCopied ? "Copied" : "Copy JSON"}
                            </button>
                          </div>
                          <pre className="max-h-48 overflow-auto rounded-xl bg-neutral-950 p-3 font-mono text-xs leading-relaxed text-emerald-300">
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
      <Dialog
        open={Boolean(runModalPlaybook)}
        onOpenChange={(open) => {
          if (!open && !runBusy) setRunModalPlaybook(null);
        }}
      >
        {runModalPlaybook && (
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Run Playbook: {runModalPlaybook.name}</DialogTitle>
              <DialogDescription>
                Configure run parameters and execute tool pipeline.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {runResult && (
                <div>
                  {runResult.status === "succeeded" && (
                    <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-800">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Pipeline Execution Succeeded</span>
                        <Pill value="succeeded" />
                      </div>
                      <div className="font-mono text-[11px] text-emerald-800">
                        Run ID: {runResult.execution_id}
                      </div>
                      <div>{runResult.reason || "All pipeline steps completed successfully."}</div>
                    </div>
                  )}

                  {runResult.status === "awaiting_approval" && (
                    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs font-medium text-amber-900">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Execution Awaiting Human Approval</span>
                        <Pill value="awaiting_approval" />
                      </div>
                      <div className="font-mono text-[11px] text-amber-800">
                        Run ID: {runResult.execution_id}
                      </div>
                      <p className="leading-relaxed text-amber-900">
                        {runResult.reason ||
                          "Policy requires authorized engineer or approver sign-off before proceeding."}
                      </p>
                      <div>
                        <Link
                          href="/approvals"
                          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-neutral-950 px-4 text-xs font-semibold text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
                        >
                          <span>Review in Approvals</span>
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M5 12h14M12 5l7 7-7 7" />
                          </svg>
                        </Link>
                      </div>
                    </div>
                  )}

                  {runResult.status === "rejected" && (
                    <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Execution Rejected</span>
                        <Pill value="rejected" />
                      </div>
                      <div className="font-mono text-[11px] text-rose-800">
                        Run ID: {runResult.execution_id}
                      </div>
                      <div>{runResult.reason || "Pipeline policy check denied execution."}</div>
                    </div>
                  )}
                </div>
              )}

              {runError && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800"
                >
                  {runError}
                </div>
              )}

              <form onSubmit={handleRunSubmit} className="space-y-4">
                <div>
                  <label htmlFor="run-drawing-id" className="mb-1.5 block text-xs font-semibold text-neutral-800">
                    Drawing ID
                  </label>
                  <input
                    id="run-drawing-id"
                    type="text"
                    required
                    value={runInputs.drawing_id}
                    onChange={(e) => setRunInputs({ ...runInputs, drawing_id: e.target.value })}
                    placeholder="e.g. DWG-2026-X1"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label htmlFor="run-material" className="mb-1.5 block text-xs font-semibold text-neutral-800">
                    Material Specification
                  </label>
                  <input
                    id="run-material"
                    type="text"
                    required
                    value={runInputs.material}
                    onChange={(e) => setRunInputs({ ...runInputs, material: e.target.value })}
                    placeholder="e.g. 6061-T6 Aluminum"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label htmlFor="run-quantity" className="mb-1.5 block text-xs font-semibold text-neutral-800">
                    Quantity
                  </label>
                  <input
                    id="run-quantity"
                    type="number"
                    min="1"
                    required
                    value={runInputs.quantity}
                    onChange={(e) => setRunInputs({ ...runInputs, quantity: e.target.value })}
                    placeholder="e.g. 25"
                    className={inputCls}
                  />
                </div>

                <DialogFooter>
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
                </DialogFooter>
              </form>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* New Playbook Modal */}
      <Dialog
        open={isNewPlaybookOpen}
        onOpenChange={(open) => {
          if (!open && !modalBusy) setIsNewPlaybookOpen(false);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Playbook</DialogTitle>
            <DialogDescription>
              Compose a repeatable multi-step FastMCP industrial automation pipeline.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {modalError && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800"
              >
                {modalError}
              </div>
            )}

            <form onSubmit={handleCreatePlaybook} className="space-y-4">
              <div>
                <label htmlFor="new-pb-name" className="mb-1.5 block text-xs font-semibold text-neutral-800">
                  Playbook Name
                </label>
                <input
                  id="new-pb-name"
                  type="text"
                  required
                  value={newPlaybookName}
                  onChange={(e) => setNewPlaybookName(e.target.value)}
                  placeholder="e.g. fastmcp_tolerance_pipeline"
                  className={inputCls}
                />
              </div>

              <div>
                <label htmlFor="new-pb-steps" className="mb-1.5 block text-xs font-semibold text-neutral-800">
                  Pipeline Steps (Comma or Line Separated Tool Names)
                </label>
                <textarea
                  id="new-pb-steps"
                  required
                  rows={3}
                  value={newPlaybookSteps}
                  onChange={(e) => setNewPlaybookSteps(e.target.value)}
                  placeholder="erp_lookup_inventory, quality_check, notify_team"
                  className={`${inputCls} h-auto py-2 font-mono text-xs`}
                />
                <p className="mt-1.5 text-xs text-neutral-600">
                  Unknown tools are auto-registered so your pipeline executes right away.
                </p>
              </div>

              <DialogFooter>
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
              </DialogFooter>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      {/* Register Tool Modal */}
      <Dialog
        open={isRegisterToolOpen}
        onOpenChange={(open) => {
          if (!open && !modalBusy) setIsRegisterToolOpen(false);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Register FastMCP Tool</DialogTitle>
            <DialogDescription>
              Add an executable action connector with input schema &amp; risk governance.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {modalError && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800"
              >
                {modalError}
              </div>
            )}

            <form onSubmit={handleRegisterTool} className="space-y-3.5">
              <div>
                <label htmlFor="reg-tool-name" className="mb-1.5 block text-xs font-semibold text-neutral-800">
                  Tool Name
                </label>
                <input
                  id="reg-tool-name"
                  type="text"
                  required
                  value={newTool.name}
                  onChange={(e) => setNewTool({ ...newTool, name: e.target.value })}
                  placeholder="e.g. fastmcp_tolerance_check"
                  className={inputCls}
                />
              </div>

              <div>
                <label htmlFor="reg-tool-desc" className="mb-1.5 block text-xs font-semibold text-neutral-800">
                  Description
                </label>
                <input
                  id="reg-tool-desc"
                  type="text"
                  value={newTool.description}
                  onChange={(e) => setNewTool({ ...newTool, description: e.target.value })}
                  placeholder="Validate geometric tolerances against ISO standards"
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="reg-tool-connector" className="mb-1.5 block text-xs font-semibold text-neutral-800">
                    Connector
                  </label>
                  <select
                    id="reg-tool-connector"
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
                  <label htmlFor="reg-tool-risk" className="mb-1.5 block text-xs font-semibold text-neutral-800">
                    Risk Classification
                  </label>
                  <select
                    id="reg-tool-risk"
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
                <label htmlFor="reg-tool-schema" className="mb-1.5 block text-xs font-semibold text-neutral-800">
                  Input Schema (JSON Schema)
                </label>
                <textarea
                  id="reg-tool-schema"
                  required
                  rows={4}
                  value={newTool.input_schema}
                  onChange={(e) => setNewTool({ ...newTool, input_schema: e.target.value })}
                  className={`${inputCls} h-auto py-2 font-mono text-xs`}
                />
              </div>

              <DialogFooter>
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
              </DialogFooter>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
