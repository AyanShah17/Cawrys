// apps/web/components/marketplace-config-modal.tsx
"use client";
import React, { useEffect, useState } from "react";
import type { MarketplaceApp } from "./marketplace-grid";
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

  // Sync state when app opens or changes
  useEffect(() => {
    if (app) {
      const cfg = (app.connection?.config as Record<string, any>) || {};
      setApiKey(typeof cfg.api_key === "string" ? cfg.api_key : "");
      setBaseUrl(typeof cfg.base_url === "string" ? cfg.base_url : "");
      setEntityId(app.connection?.entity_id || "default");
      setCustomClientId(typeof cfg.custom_client_id === "string" ? cfg.custom_client_id : "");
      setCustomClientSecret(typeof cfg.custom_client_secret === "string" ? cfg.custom_client_secret : "");
      if (cfg.custom_client_id) {
        setShowCustomOAuth(true);
      } else {
        setShowCustomOAuth(false);
      }
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

  if (!isOpen || !app) return null;

  const isFastMcp = app.provider === "fastmcp";
  const authMode = isFastMcp ? "fastmcp" : showCustomOAuth && customClientId ? "whitelabel_oauth" : "composio";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!app) return;
    setIsSubmitting(true);
    setError(null);

    let parsedExtra: any = {};
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
    } catch (err: any) {
      setError(err?.message || "Failed to save configuration and connect");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/40 backdrop-blur-md duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xl space-y-5 max-h-[90vh] flex flex-col overflow-y-auto text-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-950 text-white font-bold text-sm shadow-md">
              {app.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight text-neutral-900">{app.name}</h3>
                {isFastMcp ? (
                  <Badge variant="warning">FastMCP Protocol</Badge>
                ) : (
                  <Badge variant="secondary">Composio Connect</Badge>
                )}
              </div>
              <p className="text-xs text-neutral-500 mt-0.5">
                {app.category} · {app.tools?.length || 0} tools available
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition"
            aria-label="Close dialog"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800 flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3.5 w-3.5 text-rose-600 shrink-0" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Entity ID / User Scope */}
          <div className="space-y-1.5">
            <label htmlFor="entityId" className="block text-xs font-semibold text-neutral-700">
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
            <p className="text-[11px] text-neutral-500">
              Scopes credentials per user, team, or department. Defaults to &quot;default&quot;.
            </p>
          </div>

          {/* API Key / Token (if applicable) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="apiKey" className="font-semibold text-neutral-700">
                {isFastMcp ? "FastMCP / System Gateway API Key" : "Direct API Key / Secret Token"}
              </label>
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="text-[11px] text-neutral-500 hover:text-neutral-900 transition font-medium"
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
                  : "Enter direct API key (or leave blank to use Composio Connect OAuth)"
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-neutral-500">
              {isFastMcp
                ? "Secret token for the Industrial FastMCP server interface."
                : "If provided, bypasses interactive browser OAuth and connects directly."}
            </p>
          </div>

          {/* Base URL (Optional for On-Prem / Enterprise Instances) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="baseUrl" className="font-semibold text-neutral-700">
                Custom Endpoint / Base URL
              </label>
              <span className="text-[11px] text-neutral-400">Optional</span>
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
            <p className="text-[11px] text-neutral-500">
              Required for dedicated single-tenant or on-premise industrial instances.
            </p>
          </div>

          {/* Custom OAuth Credentials Collapsible */}
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3.5 space-y-3">
            <button
              type="button"
              onClick={() => setShowCustomOAuth(!showCustomOAuth)}
              className="flex w-full items-center justify-between text-xs font-semibold text-neutral-800 hover:text-neutral-950"
            >
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-neutral-900" aria-hidden="true">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                <span>Custom OAuth Credentials (White-Label)</span>
              </div>
              <span className="text-neutral-400 text-[11px]">
                {showCustomOAuth ? "Hide" : "Expand"}
              </span>
            </button>

            {showCustomOAuth && (
              <div className="space-y-3 pt-2 border-t border-neutral-200">
                <div className="space-y-1">
                  <label htmlFor="clientId" className="block text-[11px] font-medium text-neutral-700">
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
                  <label htmlFor="clientSecret" className="block text-[11px] font-medium text-neutral-700">
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
                <p className="text-[10px] text-neutral-400">
                  Allows connecting with your own branded OAuth application credentials.
                </p>
              </div>
            )}
          </div>

          {/* Additional Parameters */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="extraParams" className="font-semibold text-neutral-700">
                Additional Parameters (JSON or Key-Value)
              </label>
              <span className="text-[11px] text-neutral-400">Optional</span>
            </div>
            <textarea
              id="extraParams"
              rows={2}
              placeholder='e.g. { "default_channel": "#ops-alerts", "environment": "production" }'
              value={additionalParams}
              onChange={(e) => setAdditionalParams(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 shadow-xs transition-all focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 font-mono"
            />
            <p className="text-[11px] text-neutral-500">
              Extra context parameters passed to Composio toolkits or FastMCP server invocations.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 border-t border-neutral-100 pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting}
              className="shadow-sm bg-neutral-950 text-white hover:bg-neutral-800"
            >
              {isSubmitting ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-white animate-ping" />
                  <span>Connecting...</span>
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  Save Configuration &amp; Connect
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
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
