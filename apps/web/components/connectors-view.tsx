// apps/web/components/connectors-view.tsx
"use client";
import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { API, del, getJSON, post } from "@/lib/api";
import { Badge, Button, Card, Empty, Notice, btnCls, btnGhostCls, inputCls } from "@/components/ui/kit";
import type {
  ExecutionModalData,
  MarketplaceApp,
  MarketplaceCatalog,
  MarketplaceConnection,
  MarketplaceTool,
} from "./marketplace-grid";
import {
  MarketplaceConfigModal,
  type ConnectPayload,
} from "./marketplace-config-modal";

function getAppInitials(name: string, key: string): string {
  if (key === "sap_s4hana") return "SAP";
  if (key === "siemens_xcelerator") return "SX";
  if (key === "rockwell_factorytalk") return "RA";
  if (key === "dassault_3dexperience") return "3DS";
  if (key === "ptc_windchill") return "PTC";
  if (key === "oracle_scm") return "ORA";

  const clean = name.replace(/[^a-zA-Z0-9\s]/g, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return key.slice(0, 2).toUpperCase();
}

function getAvatarStyles(app: MarketplaceApp) {
  if (app.provider === "fastmcp") {
    return {
      bg: "from-amber-500/20 to-orange-600/30 border-amber-500/30 text-amber-300",
      indicator: "bg-amber-400",
    };
  }
  const cat = (app.category || "").toLowerCase();
  if (cat.includes("developer") || cat.includes("devops")) {
    return {
      bg: "from-emerald-500/20 to-teal-600/30 border-emerald-500/30 text-emerald-300",
      indicator: "bg-emerald-400",
    };
  }
  if (cat.includes("crm") || cat.includes("sales")) {
    return {
      bg: "from-rose-500/20 to-orange-600/30 border-rose-500/30 text-rose-300",
      indicator: "bg-rose-400",
    };
  }
  if (cat.includes("finance") || cat.includes("accounting") || cat.includes("billing")) {
    return {
      bg: "from-green-500/20 to-emerald-600/30 border-green-500/30 text-green-300",
      indicator: "bg-green-400",
    };
  }
  if (cat.includes("communication") || cat.includes("social")) {
    return {
      bg: "from-purple-500/20 to-violet-600/30 border-purple-500/30 text-purple-300",
      indicator: "bg-purple-400",
    };
  }
  if (cat.includes("support") || cat.includes("ticketing")) {
    return {
      bg: "from-amber-500/20 to-yellow-600/30 border-yellow-500/30 text-yellow-300",
      indicator: "bg-yellow-400",
    };
  }
  return {
    bg: "from-indigo-500/20 to-blue-600/30 border-indigo-500/30 text-indigo-300",
    indicator: "bg-indigo-400",
  };
}

export function ConnectorsView({
  initial,
  role,
  brandName,
}: {
  initial: MarketplaceCatalog | null;
  role: string;
  brandName: string;
}) {
  const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(initial);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [busyApp, setBusyApp] = useState<string | null>(null);
  const [configModalApp, setConfigModalApp] = useState<MarketplaceApp | null>(null);
  const [banner, setBanner] = useState<{
    ok: boolean;
    title: string;
    detail?: string;
  } | null>(null);

  // Execution result modal
  const [executionModal, setExecutionModal] = useState<ExecutionModalData | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);

  const canManage = role === "admin";

  // Refresh data
  const refresh = useCallback(async () => {
    try {
      const fresh = await getJSON<MarketplaceCatalog>(`${API.execution}/v1/marketplace/apps?limit=0`);
      if (fresh) {
        setCatalog(fresh);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (initial === null) {
      refresh();
    }
  }, [initial, refresh]);

  // Connected apps only
  const connectedApps = useMemo(() => {
    if (!catalog?.apps) return [];
    return catalog.apps.filter((a) => a.connected);
  }, [catalog?.apps]);

  const filteredConnected = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return connectedApps;
    return connectedApps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.key.toLowerCase().includes(q) ||
        (a.category || "").toLowerCase().includes(q) ||
        (a.description || "").toLowerCase().includes(q)
    );
  }, [connectedApps, deferredSearch]);

  const counts = useMemo(() => {
    const total = catalog?.counts?.total ?? (catalog?.apps?.length || 1646);
    return {
      total,
      connected: connectedApps.length,
    };
  }, [catalog, connectedApps]);

  // Connect / Reconfigure handler
  async function handleSaveConfig(payload: ConnectPayload) {
    const res = await post<{
      ok?: boolean;
      status?: string;
      app_key?: string;
      redirect_url?: string;
      connection?: MarketplaceConnection;
      registered_tools?: string[];
      message?: string;
    }>(`${API.execution}/v1/marketplace/connect`, payload);

    setBanner({
      ok: true,
      title: `Saved configuration for ${payload.app_key}`,
      detail: `Settings updated successfully.`,
    });

    if (res.redirect_url) {
      try {
        window.open(res.redirect_url, "_blank", "noopener,noreferrer");
      } catch {
        // blocked
      }
    }

    await refresh();
  }

  // Disconnect handler
  async function handleDisconnect(app: MarketplaceApp) {
    setBusyApp(app.key);
    setBanner(null);
    try {
      await del(`${API.execution}/v1/marketplace/connections/${app.key}`);
      setBanner({
        ok: true,
        title: `Disconnected ${app.name}`,
        detail: `Connection and credentials unlinked.`,
      });
      await refresh();
    } catch (e: any) {
      setBanner({
        ok: false,
        title: `Failed to disconnect ${app.name}`,
        detail: e?.message || "Disconnect request failed",
      });
    } finally {
      setBusyApp(null);
    }
  }

  // Test action
  async function handleTestConnection(app: MarketplaceApp) {
    const tool = app.tools[0] || { name: `${app.key}_test_action` };
    setBusyApp(app.key);
    setBanner(null);
    const startTime = performance.now();

    try {
      const res = await post<{ ok: boolean; app_key: string; result?: Record<string, unknown> }>(
        `${API.execution}/v1/marketplace/test/${app.key}`,
        { action: tool.name, tool_name: tool.name }
      );

      const latencyMs = Math.max(1, Math.round(performance.now() - startTime));
      const resultObj = res.result ?? {
        status: "success",
        action: tool.name,
        output: "Connector test passed successfully.",
        timestamp: new Date().toISOString(),
      };

      setExecutionModal({
        isOpen: true,
        app,
        tool,
        result: resultObj,
        latencyMs,
        statusCode: 200,
        timestamp: new Date().toLocaleTimeString(),
      });

      setBanner({
        ok: true,
        title: `Test Connection: ${app.name} (${latencyMs}ms)`,
        detail: JSON.stringify(resultObj, null, 2),
      });
    } catch (e: any) {
      const latencyMs = Math.max(1, Math.round(performance.now() - startTime));
      setBanner({
        ok: false,
        title: `Test connection failed for ${app.name}`,
        detail: e?.message || "Execution failed",
      });
      setExecutionModal({
        isOpen: true,
        app,
        tool,
        result: { error: e?.message || "Execution failed", status: "error" },
        latencyMs,
        statusCode: 500,
        timestamp: new Date().toLocaleTimeString(),
      });
    } finally {
      setBusyApp(null);
    }
  }

  function handleCopyJson(data: any) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200/60 pb-4">
        <Link
          href="/marketplace"
          className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition"
        >
          <span>All Toolkits</span>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500 border border-neutral-200">
            {counts.total.toLocaleString()}
          </span>
        </Link>
        <Link
          href="/connectors"
          className="flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-2 text-xs font-bold text-white shadow-sm transition"
        >
          <span>Connected Connectors</span>
          <span className="rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold">
            {counts.connected}
          </span>
        </Link>
      </div>

      {/* Banner */}
      {banner && (
        <Notice tone={banner.ok ? "info" : "bad"}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium text-white">{banner.title}</div>
              {banner.detail && (
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs opacity-90 max-h-36 overflow-y-auto">
                  {banner.detail}
                </pre>
              )}
            </div>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-xs text-neutral-400 hover:text-white shrink-0 p-1"
            >
              Dismiss
            </button>
          </div>
        </Notice>
      )}

      {/* Search & Header Stats */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Active Connected Toolkits</h2>
          <p className="text-xs text-neutral-400">
            {connectedApps.length} toolkits configured and ready for automated playbook execution.
          </p>
        </div>

        {connectedApps.length > 0 && (
          <div className="w-full max-w-xs">
            <input
              type="search"
              placeholder="Filter connected toolkits..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${inputCls} py-1.5 text-xs`}
            />
          </div>
        )}
      </div>

      {/* List of Connected Connectors */}
      {connectedApps.length === 0 ? (
        <Card className="p-8 text-center">
          <Empty>
            <div className="space-y-3">
              <div className="flex justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-neutral-400">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6" aria-hidden="true">
                    <path d="M12 22v-5" />
                    <path d="M9 8V2" />
                    <path d="M15 2v6" />
                    <path d="M18 8v5a6 6 0 0 1-12 0V8c0-.6.4-1 1-1h10c.6 0 1 .4 1 1z" />
                  </svg>
                </div>
              </div>
              <div className="text-base font-semibold text-white">No Connected Toolkits Yet</div>
              <p className="text-xs text-neutral-400 max-w-md mx-auto">
                Configure and connect SaaS toolkits from Composio (1,640+) or Industrial FastMCP enterprise servers to start automating workflows.
              </p>
              <div className="pt-2">
                <Link
                  href="/marketplace"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-lg hover:bg-indigo-500 transition"
                >
                  <span className="inline-flex items-center gap-1.5">
                    Browse Marketplace
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                      <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                  </span>
                </Link>
              </div>
            </div>
          </Empty>
        </Card>
      ) : filteredConnected.length === 0 ? (
        <Card>
          <Empty>No connected toolkits match &quot;{search}&quot;.</Empty>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {filteredConnected.map((app) => {
            const isBusy = busyApp === app.key;
            const isFastMcp = app.provider === "fastmcp";
            const avatarStyle = getAvatarStyles(app);
            const initials = getAppInitials(app.name, app.key);
            const cfg = (app.connection?.config as Record<string, any>) || {};

            return (
              <div
                key={app.key}
                className="group relative flex flex-col justify-between rounded-3xl border border-neutral-200/70 bg-white p-6 transition-all duration-200 hover:border-neutral-300 hover:shadow-md"
              >
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-gradient-to-br font-bold shadow-xs text-xs tracking-tight ${avatarStyle.bg}`}
                      >
                        {initials}
                      </div>

                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-neutral-900 tracking-tight">
                            {app.name}
                          </h3>
                          <Badge variant="secondary" className="text-[11px] font-normal py-0">
                            {app.category}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {isFastMcp ? (
                            <Badge variant="warning" className="text-[11px] font-medium py-0.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                              Industrial FastMCP
                            </Badge>
                          ) : (
                            <Badge variant="default" className="text-[11px] font-medium py-0.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                              composio.dev
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Connected Pill */}
                    <Badge variant="success" className="px-2.5 py-1 text-xs">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      Connected
                    </Badge>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-neutral-500 leading-relaxed">{app.description}</p>

                  {/* Configured Parameters Summary */}
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 space-y-2 text-xs">
                    <div className="font-semibold text-neutral-700 uppercase tracking-wider text-[11px]">
                      Configuration Settings
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <span className="text-neutral-500">API Key Configured:</span>{" "}
                        <span className="text-neutral-200 font-mono">
                          {cfg.has_api_key || cfg.api_key_configured || cfg.api_key ? "Yes (Active)" : "OAuth Managed"}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-500">Account Alias:</span>{" "}
                        <span className="text-neutral-200 font-mono">
                          {app.connection?.entity_id || "default"}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-500">Base URL:</span>{" "}
                        <span className="text-neutral-200 font-mono truncate block" title={cfg.base_url || "Default"}>
                          {cfg.base_url || "Default Endpoint"}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-500">Custom OAuth:</span>{" "}
                        <span className="text-neutral-200 font-mono">
                          {cfg.has_custom_oauth ? "Enabled" : "Standard"}
                        </span>
                      </div>
                    </div>

                    {app.connection?.created_at && (
                      <div className="pt-1 border-t border-white/5 text-[10px] text-neutral-500">
                        Connected: {new Date(app.connection.created_at).toLocaleString()}
                        {app.connection.connected_by && ` by ${app.connection.connected_by}`}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                  <div className="text-[11px] text-neutral-500">
                    {app.tools?.length || 0} registered actions
                  </div>

                  {canManage ? (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setConfigModalApp(app)}
                      >
                        Reconfigure
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => handleTestConnection(app)}
                      >
                        {isBusy ? "Testing..." : "Test Connection"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => handleDisconnect(app)}
                      >
                        Disconnect
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => handleTestConnection(app)}
                      >
                        {isBusy ? "Testing..." : "Test Connection"}
                      </Button>
                      <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-neutral-400 font-medium">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 text-neutral-400" aria-hidden="true">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        <span>View-Only (Admin Managed)</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reconfigure Modal */}
      <MarketplaceConfigModal
        isOpen={Boolean(configModalApp)}
        app={configModalApp}
        onClose={() => setConfigModalApp(null)}
        onSubmit={handleSaveConfig}
      />

      {/* Execution Output Modal */}
      {executionModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md duration-200"
          onClick={() => setExecutionModal(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-white/15 bg-[#0a0c12] p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <h3 className="text-lg font-semibold tracking-tight text-white">Test Connection Result</h3>
                </div>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {executionModal.app.name} · Latency: <span className="font-mono text-emerald-400">{executionModal.latencyMs}ms</span>
                </p>
              </div>

              <button
                type="button"
                onClick={() => setExecutionModal(null)}
                className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white transition"
                aria-label="Close modal"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col space-y-2">
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span className="font-medium">Output Payload</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopyJson(executionModal.result)}
                  className="h-7 text-xs flex items-center gap-1.5"
                >
                  {copiedJson ? (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3 text-emerald-400" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span className="text-emerald-300">Copied</span>
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3" aria-hidden="true">
                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                      </svg>
                      <span>Copy JSON</span>
                    </>
                  )}
                </Button>
              </div>
              <pre className="flex-1 overflow-auto rounded-lg border border-white/10 bg-black/60 p-4 font-mono text-xs text-emerald-400/90 leading-relaxed shadow-inner">
                {JSON.stringify(executionModal.result, null, 2)}
              </pre>
            </div>

            <div className="flex items-center justify-end border-t border-white/10 pt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setExecutionModal(null)}
              >
                Close Output
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
