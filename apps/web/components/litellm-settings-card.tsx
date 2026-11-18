// apps/web/components/litellm-settings-card.tsx
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/kit";
import { IconTune, ProviderBrandIcon } from "@/components/ui/icons";
import { getJSON, post } from "@/lib/api";
import {
  DEFAULT_LITELLM_CONFIG,
  LITELLM_CONFIG_EVENT,
  LITELLM_PROVIDERS,
  LiteLLMConfig,
  LiteLLMModal,
  loadLiteLLMConfig,
  saveLiteLLMConfig,
} from "./litellm-modal";

export function LiteLLMSettingsCard({ role }: { role?: string }) {
  const isEngineer = role === "engineer";
  const [config, setConfig] = useState<LiteLLMConfig>(DEFAULT_LITELLM_CONFIG);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [syncedWithServer, setSyncedWithServer] = useState(false);

  useEffect(() => {
    const local = loadLiteLLMConfig();
    setConfig(local);

    async function fetchServerConfig() {
      try {
        const res = await getJSON<{
          ok: boolean;
          provider?: string;
          model?: string;
          api_key?: string;
          base_url?: string;
        }>("/api/execution/v1/chat/model_config");
        if (res && res.provider && res.model) {
          const merged: LiteLLMConfig = {
            provider: res.provider,
            model: res.model || local.model,
            apiKey: res.api_key || local.apiKey || "",
            baseUrl: res.base_url || local.baseUrl || "",
          };
          setConfig(merged);
          saveLiteLLMConfig(merged);
          setSyncedWithServer(true);
        }
      } catch {
        // Backend might still be spinning up, local is fine
      }
    }
    fetchServerConfig();

    function handleConfigChange(e: Event) {
      const customEvent = e as CustomEvent<LiteLLMConfig>;
      if (customEvent.detail) {
        setConfig(customEvent.detail);
      }
    }
    window.addEventListener(LITELLM_CONFIG_EVENT, handleConfigChange);
    return () => window.removeEventListener(LITELLM_CONFIG_EVENT, handleConfigChange);
  }, []);

  async function handleSaveConfig(newConfig: LiteLLMConfig) {
    setConfig(newConfig);
    try {
      await post("/api/execution/v1/chat/model_config", {
        provider: newConfig.provider,
        model: newConfig.model,
        api_key: newConfig.apiKey,
        base_url: newConfig.baseUrl,
      });
      setSyncedWithServer(true);
    } catch (err) {
      console.warn("Could not sync model config to backend:", err);
    }
  }

  const providerInfo = LITELLM_PROVIDERS[config.provider] || {
    id: config.provider,
    name: config.provider,
    badge: "Active",
    defaultModel: config.model,
    models: [config.model],
    description: "",
  };
  const hasCustomKey = Boolean(config.apiKey && config.apiKey.trim().length > 0);

  return (
    <>
      <Card
        title="AI Gateway & LiteLLM Provider"
        action={
          isEngineer ? (
            <Badge variant="warning">Admin Managed</Badge>
          ) : (
            <Badge variant="success">
              {syncedWithServer ? "Synced" : "Active Routing"}
            </Badge>
          )
        }
      >
        <div className="space-y-4 text-sm">
          <p className="text-xs leading-relaxed text-neutral-600">
            Route agent reasoning and industrial tool-calling to any LiteLLM-compatible foundation
            model. Supports bring-your-own-key (BYOK) for Google Gemini, OpenAI, Anthropic, DeepSeek,
            Groq, and self-hosted Ollama.
          </p>

          <div className="space-y-3 border-t border-neutral-100 pt-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900">
                <ProviderBrandIcon provider={config.provider} className="h-4 w-4 text-neutral-900" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-neutral-950">{providerInfo.name}</div>
                <div className="truncate font-mono text-xs text-neutral-600" title={config.model}>
                  {config.model}
                </div>
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 border-t border-neutral-100 pt-3 text-xs sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-neutral-600">API Key</dt>
                <dd className="mt-0.5 truncate font-mono text-neutral-900">
                  {isEngineer
                    ? "Configured by Administrator"
                    : hasCustomKey
                    ? "Tenant Key Configured"
                    : "System Default"}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-neutral-600">Base URL</dt>
                <dd className="mt-0.5 truncate font-mono text-neutral-900" title={isEngineer ? "Managed Endpoint" : config.baseUrl || "Standard Endpoint"}>
                  {isEngineer
                    ? "Managed Endpoint"
                    : config.baseUrl || "Standard Endpoint"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(true)}
            >
              {isEngineer ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-neutral-600" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span>View Configuration (Admin Managed)</span>
                </>
              ) : (
                <>
                  <IconTune className="h-3.5 w-3.5 text-neutral-700" />
                  <span>Configure Provider &amp; Model</span>
                </>
              )}
            </Button>

            <Link
              href="/chat"
              className="inline-flex items-center gap-1 rounded text-xs font-medium text-blue-700 underline-offset-2 transition-colors hover:text-blue-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
            >
              <span>Open Agent Chat</span>
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
        </div>
      </Card>

      <LiteLLMModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        currentConfig={config}
        onSave={handleSaveConfig}
        role={role}
        readOnly={isEngineer}
      />
    </>
  );
}
