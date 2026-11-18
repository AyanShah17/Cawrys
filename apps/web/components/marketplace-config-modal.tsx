// apps/web/components/marketplace-config-modal.tsx
"use client";
import React, { useEffect, useState } from "react";
import type { ExecutionModalData, MarketplaceApp } from "./marketplace-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ConnectPayload = {
  app_key: string;
  auth_mode: string;
  entity_id: string;
  api_key?: string;
  base_url?: string;
  custom_client_id?: string;
  custom_client_secret?: string;
  config: Record<string, unknown>;
};

export function getAppInitials(name: string, key: string): string {
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

export function getAvatarTone(app: MarketplaceApp): string {
  if (app.provider === "fastmcp") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  const cat = (app.category || "").toLowerCase();
  if (cat.includes("developer") || cat.includes("devops") || cat.includes("finance") || cat.includes("accounting") || cat.includes("billing")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (cat.includes("crm") || cat.includes("sales")) {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  if (cat.includes("support") || cat.includes("ticketing")) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (cat.includes("communication") || cat.includes("social")) {
    return "border-sky-200 bg-sky-50 text-sky-800";
  }
  return "border-blue-200 bg-blue-50 text-blue-800";
}

export function ExecutionResultModal({
  data,
  title,
  copiedJson,
  onCopyJson,
  onRerun,
  onClose,
}: {
  data: ExecutionModalData | null;
  title: string;
  copiedJson: boolean;
  onCopyJson: (payload: unknown) => void;
  onRerun?: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!data) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [data, onClose]);

  if (!data) return null;

  const isSuccess = data.statusCode === 200;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col space-y-4 rounded-2xl bg-white p-6 text-neutral-950 shadow-[0_20px_50px_rgba(15,23,42,0.16)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${isSuccess ? "bg-emerald-600" : "bg-rose-600"}`}
                aria-hidden="true"
              />
              <h3 className="text-lg font-semibold tracking-tight text-neutral-950">{title}</h3>
            </div>
            <p className="mt-1 truncate text-xs text-neutral-600">
              {data.app.name} &middot;{" "}
              <code className="font-mono font-medium text-neutral-800">{data.tool.name}</code>
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-neutral-500 transition-colors duration-150 ease-out-quart hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
            aria-label="Close modal"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isSuccess ? "success" : "destructive"} className="tabular-nums">
            <span className={`h-1.5 w-1.5 rounded-full ${isSuccess ? "bg-emerald-600" : "bg-rose-600"}`} aria-hidden="true" />
            {isSuccess ? "200 OK · Executed" : `${data.statusCode} Error`}
          </Badge>

          <Badge variant="info" className="tabular-nums">
            Latency: {data.latencyMs} ms
          </Badge>

          <Badge variant="secondary">
            {data.app.provider === "fastmcp" ? "Industrial FastMCP" : "composio.dev"}
          </Badge>

          <span className="ml-auto font-mono text-xs tabular-nums text-neutral-600">
            {data.timestamp}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col space-y-2">
          <div className="flex items-center justify-between text-xs text-neutral-600">
            <span className="font-medium">Structured JSON Response</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onCopyJson(data.result)}
              className="h-7 px-3 text-xs"
            >
              {copiedJson ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3 text-emerald-700" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span className="font-medium text-emerald-800">Copied</span>
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

          <pre className="flex-1 overflow-auto rounded-xl border border-neutral-800 bg-neutral-950 p-4 font-mono text-xs leading-relaxed text-emerald-400">
            {JSON.stringify(data.result, null, 2)}
          </pre>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-4">
          {onRerun ? (
            <Button type="button" size="sm" onClick={onRerun}>
              Re-Run Action
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close Output
          </Button>
        </div>
      </div>
    </div>
  );
}

export function MarketplaceConfigModal({
  isOpen,
  app,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  app: MarketplaceApp | null;
  onClose: () => void;
  onSubmit: (payload: ConnectPayload) => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [entityId, setEntityId] = useState("default");
  const [showCustomOAuth, setShowCustomOAuth] = useState(false);
  const [customClientId, setCustomClientId] = useState("");
  const [customClientSecret, setCustomClientSecret] = useState("");
  const [additionalParams, setAdditionalParams] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (app) {
      const cfg = (app.connection?.config as Record<string, unknown>) || {};
      setApiKey(typeof cfg.api_key === "string" ? cfg.api_key : "");
      setBaseUrl(typeof cfg.base_url === "string" ? cfg.base_url : "");
      setEntityId(app.connection?.entity_id || "default");
      setCustomClientId(typeof cfg.custom_client_id === "string" ? cfg.custom_client_id : "");
      setCustomClientSecret(typeof cfg.custom_client_secret === "string" ? cfg.custom_client_secret : "");
      setShowCustomOAuth(Boolean(cfg.custom_client_id));
      if (cfg.additional_parameters) {
        setAdditionalParams(
          typeof cfg.additional_parameters === "string"
            ? cfg.additional_parameters
            : JSON.stringify(cfg.additional_parameters, null, 2)
        );
      } else {
        setAdditionalParams("");
      }
      setError(null);
    }
  }, [app]);

  useEffect(() => {
    if (!isOpen || !app) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, app, onClose]);

  if (!isOpen || !app) return null;

  const isFastMcp = app.provider === "fastmcp";
  const authMode = isFastMcp ? "fastmcp" : showCustomOAuth && customClientId ? "whitelabel_oauth" : "composio";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!app) return;
    setIsSubmitting(true);
    setError(null);

    let parsedExtra: Record<string, unknown> = {};
    if (additionalParams.trim()) {
      try {
        parsedExtra = JSON.parse(additionalParams.trim());
      } catch {
        parsedExtra = { raw_parameters: additionalParams.trim() };
      }
    }

    const payload: ConnectPayload = {
      app_key: app.key,
      auth_mode: authMode,
      entity_id: entityId.trim() || "default",
      api_key: apiKey.trim() || undefined,
      base_url: baseUrl.trim() || undefined,
      custom_client_id: customClientId.trim() || undefined,
      custom_client_secret: customClientSecret.trim() || undefined,
      config: {
        app_name: app.name,
        provider: app.provider || "composio",
        category: app.category,
        base_url: baseUrl.trim() || undefined,
        api_key_configured: Boolean(apiKey.trim()),
        has_custom_oauth: Boolean(customClientId.trim()),
        additional_parameters: parsedExtra,
        configured_at: new Date().toISOString(),
      },
    };

    try {
      await onSubmit(payload);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save configuration and connect";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Configure ${app.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-xl flex-col space-y-5 overflow-y-auto rounded-2xl bg-white p-6 text-neutral-950 shadow-[0_20px_50px_rgba(15,23,42,0.16)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-xs font-bold text-white">
              {getAppInitials(app.name, app.key)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-base font-semibold tracking-tight text-neutral-950">
                  {app.name}
                </h3>
                {isFastMcp ? (
                  <Badge variant="warning">FastMCP Protocol</Badge>
                ) : (
                  <Badge variant="secondary">Composio Connect</Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs tabular-nums text-neutral-600">
                {app.category} &middot; {app.tools?.length || 0} tools available
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-neutral-500 transition-colors duration-150 ease-out-quart hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
            aria-label="Close dialog"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-medium text-rose-800">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5 shrink-0 text-rose-700" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Entity ID / User Scope */}
          <div className="space-y-1.5">
            <label htmlFor="entityId" className="block text-xs font-semibold text-neutral-800">
              Entity ID / Workgroup Scope
            </label>
            <Input
              id="entityId"
              type="text"
              placeholder="e.g. default, org_sales, prod_cluster"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              required
            />
            <p className="text-xs text-neutral-600">
              Scopes credentials per user, team, or department. Defaults to &quot;default&quot;.
            </p>
          </div>

          {/* API Key / Token */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="apiKey" className="font-semibold text-neutral-800">
                {isFastMcp ? "FastMCP / System Gateway API Key" : "Direct API Key / Secret Token"}
              </label>
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="rounded px-1.5 py-0.5 text-xs font-medium text-neutral-600 transition-colors hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              >
                {showApiKey ? "Hide" : "Reveal"}
              </button>
            </div>
            <Input
              id="apiKey"
              type={showApiKey ? "text" : "password"}
              placeholder={
                isFastMcp
                  ? "Enter SAP/Siemens/Rockwell Gateway Secret"
                  : "Enter direct API key (or leave blank for Composio Connect OAuth)"
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-xs text-neutral-600">
              {isFastMcp
                ? "Secret token for the Industrial FastMCP server interface."
                : "If provided, bypasses interactive browser OAuth and connects directly."}
            </p>
          </div>

          {/* Base URL */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="baseUrl" className="font-semibold text-neutral-800">
                Custom Endpoint / Base URL
              </label>
              <span className="text-xs text-neutral-600">Optional</span>
            </div>
            <Input
              id="baseUrl"
              type="url"
              placeholder={
                isFastMcp
                  ? "e.g. https://sap-gateway.internal.corp:8443"
                  : "e.g. https://jira.mycompany.atlassian.net or self-hosted endpoint"
              }
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-xs text-neutral-600">
              Required for dedicated single-tenant or on-premise industrial instances.
            </p>
          </div>

          {/* Custom OAuth Credentials Collapsible */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3.5">
            <button
              type="button"
              onClick={() => setShowCustomOAuth(!showCustomOAuth)}
              aria-expanded={showCustomOAuth}
              className="flex w-full items-center justify-between rounded-lg text-xs font-semibold text-neutral-800 transition-colors hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
            >
              <span className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-neutral-700" aria-hidden="true">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                <span>Custom OAuth Credentials (White-Label)</span>
              </span>
              <span className="text-xs font-medium text-neutral-600">
                {showCustomOAuth ? "Hide" : "Expand"}
              </span>
            </button>

            {showCustomOAuth && (
              <div className="mt-3 space-y-3 border-t border-neutral-200 pt-3">
                <div className="space-y-1">
                  <label htmlFor="clientId" className="block text-xs font-medium text-neutral-700">
                    Custom Client ID
                  </label>
                  <Input
                    id="clientId"
                    type="text"
                    placeholder="Enter your enterprise OAuth Client ID"
                    value={customClientId}
                    onChange={(e) => setCustomClientId(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="clientSecret" className="block text-xs font-medium text-neutral-700">
                    Custom Client Secret
                  </label>
                  <Input
                    id="clientSecret"
                    type="password"
                    placeholder="Enter your enterprise OAuth Client Secret"
                    value={customClientSecret}
                    onChange={(e) => setCustomClientSecret(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <p className="text-xs text-neutral-600">
                  Allows connecting with your own branded OAuth application credentials.
                </p>
              </div>
            )}
          </div>

          {/* Additional Parameters */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="extraParams" className="font-semibold text-neutral-800">
                Additional Parameters (JSON or Key-Value)
              </label>
              <span className="text-xs text-neutral-600">Optional</span>
            </div>
            <textarea
              id="extraParams"
              rows={2}
              placeholder='e.g. { "default_channel": "#ops-alerts", "environment": "production" }'
              value={additionalParams}
              onChange={(e) => setAdditionalParams(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2 font-mono text-xs text-neutral-950 placeholder:text-neutral-500 transition-colors duration-150 ease-out-quart focus-visible:border-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950/20"
            />
            <p className="text-xs text-neutral-600">
              Extra context parameters passed to Composio toolkits or FastMCP server invocations.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-neutral-100 pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="inline-flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
                  </svg>
                  <span>Connecting...</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span>Save Configuration &amp; Connect</span>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </span>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
