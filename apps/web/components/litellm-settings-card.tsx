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
    // 1. First load from localStorage for instant display
    const local = loadLiteLLMConfig();
    setConfig(local);

    // 2. Query execution backend for persistent tenant model config
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

    // 3. Listen for cross-component config updates
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
      <Card title="AI Gateway & LiteLLM Provider Configuration">
        <div className="space-y-4 text-sm">
          <p className="text-xs text-neutral-400">
            Route agent reasoning and industrial tool-calling to any LiteLLM-compatible foundation
            model. Supports bring-your-own-key (BYOK) for Google Gemini, OpenAI, Anthropic, DeepSeek,
            Groq, and self-hosted Ollama.
          </p>

          <div className="rounded-2xl border border-neutral-200/80 bg-neutral-50 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-900 shadow-xs">
                  <ProviderBrandIcon provider={config.provider} className="h-4 w-4 text-neutral-900" />
                </div>
                <div>
                  <div className="font-semibold text-neutral-900">{providerInfo.name}</div>
                  <div className="text-[11px] text-neutral-500 font-mono">{config.model}</div>
                </div>
              </div>
              {isEngineer ? (
                <Badge variant="warning" className="text-[10px]">
                  Configured by Administrator
                </Badge>
              ) : (
                <Badge variant="success" className="text-[10px]">
                  Active Routing
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-neutral-200/70 pt-2 text-xs">
              <div>
                <span className="text-neutral-500">API Key: </span>
                <span className="text-neutral-800 font-mono">
                  {isEngineer
                    ? "Configured by Administrator"
                    : hasCustomKey
                    ? "•••••••• (Tenant Key)"
                    : "System Default"}
                </span>
              </div>
              <div>
                <span className="text-neutral-500">Base URL: </span>
                <span className="text-neutral-800 font-mono truncate">
                  {isEngineer
                    ? "Managed Endpoint"
                    : config.baseUrl || "Standard Endpoint"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(true)}
              className="gap-1.5"
            >
              {isEngineer ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-neutral-400">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span>View Configuration (Admin Managed)</span>
                </>
              ) : (
                <>
                  <IconTune className="h-3.5 w-3.5 text-neutral-300" />
                  <span>Configure Provider &amp; Model</span>
                </>
              )}
            </Button>

            <Link
              href="/chat"
              className="text-xs font-medium text-brand hover:underline inline-flex items-center gap-1"
            >
              Open Agent Chat &rarr;
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
