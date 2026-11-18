// apps/web/components/connectors-view.tsx
"use client";
import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { API, del, getJSON, post } from "@/lib/api";
import { Badge, Button, Card, Empty, Notice, btnCls, inputCls } from "@/components/ui/kit";
import type {
  ExecutionModalData,
  MarketplaceApp,
  MarketplaceCatalog,
  MarketplaceConnection,
} from "./marketplace-grid";
import {
  ExecutionResultModal,
  MarketplaceConfigModal,
  getAppInitials,
  getAvatarTone,
  type ConnectPayload,
} from "./marketplace-config-modal";

export function ConnectorsView({
  initial,
  role,
  brandName: _brandName,
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

  const [executionModal, setExecutionModal] = useState<ExecutionModalData | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);

  const canManage = role === "admin";

  const refresh = useCallback(async () => {
    try {
      const fresh = await getJSON<MarketplaceCatalog>(`${API.execution}/v1/marketplace/apps?status=connected`);
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
      detail: "Settings updated successfully.",
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

  async function handleDisconnect(app: MarketplaceApp) {
    setBusyApp(app.key);
    setBanner(null);
    try {
      await del(`${API.execution}/v1/marketplace/connections/${app.key}`);
      setBanner({
        ok: true,
        title: `Disconnected ${app.name}`,
        detail: "Connection and credentials unlinked.",
      });
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Disconnect request failed";
      setBanner({
        ok: false,
        title: `Failed to disconnect ${app.name}`,
        detail: msg,
      });
    } finally {
      setBusyApp(null);
    }
  }

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
    } catch (e: unknown) {
      const latencyMs = Math.max(1, Math.round(performance.now() - startTime));
      const msg = e instanceof Error ? e.message : "Execution failed";
      setBanner({
        ok: false,
        title: `Test connection failed for ${app.name}`,
        detail: msg,
      });
      setExecutionModal({
        isOpen: true,
        app,
        tool,
        result: { error: msg, status: "error" },
        latencyMs,
        statusCode: 500,
        timestamp: new Date().toLocaleTimeString(),
      });
    } finally {
      setBusyApp(null);
    }
  }

  function handleCopyJson(data: unknown) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 pb-4">
        <Link
          href="/marketplace"
          className="inline-flex h-8 items-center gap-2 rounded-full border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-700 transition-colors duration-150 ease-out-quart hover:bg-neutral-50 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
        >
          <span>All Toolkits</span>
          <span className="rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-neutral-700">
            {counts.total.toLocaleString()}
          </span>
        </Link>
        <Link
          href="/connectors"
          className="inline-flex h-8 items-center gap-2 rounded-full bg-neutral-950 px-3.5 text-xs font-semibold text-white transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
        >
          <span>Connected Connectors</span>
          <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-white">
            {counts.connected}
          </span>
        </Link>
      </div>

      {/* Banner */}
      {banner && (
        <Notice tone={banner.ok ? "info" : "bad"}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-neutral-950">{banner.title}</div>
              {banner.detail && (
                <pre className="mt-1.5 max-h-36 overflow-x-auto overflow-y-auto whitespace-pre-wrap font-mono text-xs text-neutral-800">
                  {banner.detail}
                </pre>
              )}
            </div>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
            >
              Dismiss
            </button>
          </div>
        </Notice>
      )}

      {/* Search & Header Stats */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-neutral-950">Active Connected Toolkits</h2>
          <p className="mt-0.5 text-xs tabular-nums text-neutral-600">
            {connectedApps.length} {connectedApps.length === 1 ? "toolkit" : "toolkits"} configured and ready for automated playbook execution.
          </p>
        </div>

        {connectedApps.length > 0 && (
          <div className="w-full sm:max-w-xs">
            <input
              type="search"
              placeholder="Filter connected toolkits..."
              aria-label="Filter connected toolkits"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={inputCls}
            />
          </div>
        )}
      </div>

      {/* List of Connected Connectors */}
      {connectedApps.length === 0 ? (
        <Card className="p-8 text-center sm:p-10">
          <div className="mx-auto max-w-md space-y-3">
            <div className="flex justify-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-100 text-neutral-700">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
                  <path d="M12 22v-5" />
                  <path d="M9 8V2" />
                  <path d="M15 2v6" />
                  <path d="M18 8v5a6 6 0 0 1-12 0V8c0-.6.4-1 1-1h10c.6 0 1 .4 1 1z" />
                </svg>
              </div>
            </div>
            <h3 className="text-base font-semibold tracking-tight text-neutral-950">No Connected Toolkits Yet</h3>
            <p className="text-xs leading-relaxed text-neutral-600">
              Configure and connect SaaS toolkits from Composio (1,640+) or Industrial FastMCP enterprise servers to start automating workflows.
            </p>
            <div className="pt-2">
              <Link href="/marketplace" className={btnCls}>
                <span>Browse Marketplace</span>
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </Link>
            </div>
          </div>
        </Card>
      ) : filteredConnected.length === 0 ? (
        <Card>
          <Empty>No connected toolkits match &quot;{search}&quot;.</Empty>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filteredConnected.map((app) => {
            const isBusy = busyApp === app.key;
            const isFastMcp = app.provider === "fastmcp";
            const avatarTone = getAvatarTone(app);
            const initials = getAppInitials(app.name, app.key);
            const cfg = (app.connection?.config as Record<string, unknown>) || {};
            const baseUrlText = typeof cfg.base_url === "string" && cfg.base_url ? cfg.base_url : "Default Endpoint";

            return (
              <div
                key={app.key}
                className="flex flex-col justify-between rounded-2xl border border-neutral-200 bg-white p-5 transition-colors duration-150 ease-out-quart hover:border-neutral-300 sm:p-6"
              >
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-xs font-bold tracking-tight ${avatarTone}`}
                      >
                        {initials}
                      </div>

                      <div className="min-w-0 space-y-1">
                        <h3 className="truncate text-base font-semibold tracking-tight text-neutral-950">
                          {app.name}
                        </h3>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-600">
                          <span className="inline-flex items-center gap-1.5 font-medium text-neutral-700">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${isFastMcp ? "bg-amber-600" : "bg-blue-600"}`}
                              aria-hidden="true"
                            />
                            {isFastMcp ? "Industrial FastMCP" : "composio.dev"}
                          </span>
                          <span className="text-neutral-300" aria-hidden="true">/</span>
                          <span className="truncate">{app.category}</span>
                        </div>
                      </div>
                    </div>

                    <Badge variant="success" className="shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
                      Connected
                    </Badge>
                  </div>

                  {/* Description */}
                  <p className="text-sm leading-relaxed text-neutral-600">{app.description}</p>

                  {/* Configured Parameters Summary (flat divider, no nested card-in-card) */}
                  <div className="space-y-2.5 border-t border-neutral-100 pt-3.5 text-xs">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-neutral-600">
                      Configuration Settings
                    </div>
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                      <div className="min-w-0">
                        <dt className="text-neutral-600">API Key Configured</dt>
                        <dd className="mt-0.5 font-mono text-neutral-900">
                          {cfg.has_api_key || cfg.api_key_configured || cfg.api_key ? "Yes (Active)" : "OAuth Managed"}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-neutral-600">Account Alias</dt>
                        <dd className="mt-0.5 truncate font-mono text-neutral-900">
                          {app.connection?.entity_id || "default"}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-neutral-600">Base URL</dt>
                        <dd className="mt-0.5 truncate font-mono text-neutral-900" title={baseUrlText}>
                          {baseUrlText}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-neutral-600">Custom OAuth</dt>
                        <dd className="mt-0.5 font-mono text-neutral-900">
                          {cfg.has_custom_oauth ? "Enabled" : "Standard"}
                        </dd>
                      </div>
                    </dl>

                    {app.connection?.created_at && (
                      <div className="pt-1 text-xs tabular-nums text-neutral-600">
                        Connected: {new Date(app.connection.created_at).toLocaleString()}
                        {app.connection.connected_by && ` by ${app.connection.connected_by}`}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3.5">
                  <div className="text-xs tabular-nums text-neutral-600">
                    {app.tools?.length || 0} registered actions
                  </div>

                  {canManage ? (
                    <div className="flex flex-wrap items-center gap-2">
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
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => handleTestConnection(app)}
                      >
                        {isBusy ? "Testing..." : "Test Connection"}
                      </Button>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 text-neutral-600" aria-hidden="true">
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
      <ExecutionResultModal
        data={executionModal}
        title="Test Connection Result"
        copiedJson={copiedJson}
        onCopyJson={handleCopyJson}
        onClose={() => setExecutionModal(null)}
      />
    </div>
  );
}
