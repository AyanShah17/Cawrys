// apps/web/components/litellm-modal.tsx
"use client";

import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type LiteLLMProviderKey =
  | "gemini"
  | "openai"
  | "anthropic"
  | "deepseek"
  | "groq"
  | "ollama"
  | "mistral"
  | "custom";

export interface LiteLLMProviderInfo {
  id: LiteLLMProviderKey;
  name: string;
  icon: string;
  badge: string;
  defaultModel: string;
  models: string[];
  keyPlaceholder: string;
  defaultBaseUrl?: string;
  description: string;
}

export const LITELLM_PROVIDERS: Record<LiteLLMProviderKey, LiteLLMProviderInfo> = {
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    icon: "✨",
    badge: "Official Recommended",
    defaultModel: "gemini/gemini-2.5-flash",
    models: [
      "gemini/gemini-2.5-flash",
      "gemini/gemini-1.5-pro",
      "gemini/gemini-2.0-flash",
      "gemini/gemini-1.5-flash",
    ],
    keyPlaceholder: "AIzaSy...",
    description: "Ultra-fast multimodal reasoning with 1M+ token context window.",
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    icon: "🟢",
    badge: "Production Standard",
    defaultModel: "openai/gpt-4o",
    models: [
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "openai/o1",
      "openai/o3-mini",
      "openai/gpt-4-turbo",
    ],
    keyPlaceholder: "sk-proj-...",
    description: "Industry standard function calling and reasoning models.",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic Claude",
    icon: "🟣",
    badge: "Advanced Analysis",
    defaultModel: "anthropic/claude-3-5-sonnet-20241022",
    models: [
      "anthropic/claude-3-5-sonnet-20241022",
      "anthropic/claude-3-5-haiku-20241022",
      "anthropic/claude-3-opus-20240229",
    ],
    keyPlaceholder: "sk-ant-...",
    description: "Top-tier complex coding, data synthesis, and tool execution.",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    icon: "🐋",
    badge: "High Performance / Value",
    defaultModel: "deepseek/deepseek-chat",
    models: [
      "deepseek/deepseek-chat",
      "deepseek/deepseek-reasoner",
    ],
    keyPlaceholder: "sk-...",
    description: "State-of-the-art open-weights model with reasoning capabilities.",
  },
  groq: {
    id: "groq",
    name: "Groq",
    icon: "⚡",
    badge: "Ultra Low Latency",
    defaultModel: "groq/llama-3.3-70b-versatile",
    models: [
      "groq/llama-3.3-70b-versatile",
      "groq/llama-3.1-8b-instant",
      "groq/mixtral-8x7b-32768",
    ],
    keyPlaceholder: "gsk_...",
    description: "Sub-second LPU inference speeds for real-time agent loops.",
  },
  ollama: {
    id: "ollama",
    name: "Ollama / Local",
    icon: "🦙",
    badge: "Self-Hosted / Air-Gapped",
    defaultModel: "ollama/qwen2.5",
    models: [
      "ollama/qwen2.5",
      "ollama/llama3.1",
      "ollama/mistral",
      "ollama/deepseek-r1",
    ],
    keyPlaceholder: "Optional or local token",
    defaultBaseUrl: "http://localhost:11434",
    description: "On-premise zero-data-leakage inference on local hardware.",
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    icon: "🌊",
    badge: "European Sovereign AI",
    defaultModel: "mistral/mistral-large-latest",
    models: [
      "mistral/mistral-large-latest",
      "mistral/codestral-latest",
      "mistral/mistral-small-latest",
    ],
    keyPlaceholder: "...",
    description: "High efficiency enterprise models for industrial agents.",
  },
  custom: {
    id: "custom",
    name: "Custom LiteLLM Proxy",
    icon: "🔌",
    badge: "Enterprise Gateway",
    defaultModel: "custom/my-model",
    models: [
      "custom/my-model",
      "custom/enterprise-llm",
    ],
    keyPlaceholder: "Bearer token / secret",
    defaultBaseUrl: "http://localhost:4000",
    description: "Direct routing to your centralized LiteLLM proxy or vLLM server.",
  },
};

export interface LiteLLMConfig {
  provider: LiteLLMProviderKey;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export const DEFAULT_LITELLM_CONFIG: LiteLLMConfig = {
  provider: "gemini",
  model: "gemini/gemini-2.5-flash",
  apiKey: "",
  baseUrl: "",
};

export const LITELLM_STORAGE_KEY = "cawrys_litellm_config";

export function loadLiteLLMConfig(): LiteLLMConfig {
  if (typeof window === "undefined") return DEFAULT_LITELLM_CONFIG;
  try {
    const raw = localStorage.getItem(LITELLM_STORAGE_KEY);
    if (!raw) return DEFAULT_LITELLM_CONFIG;
    const parsed = JSON.parse(raw);
    const validProvider = (parsed.provider in LITELLM_PROVIDERS)
      ? (parsed.provider as LiteLLMProviderKey)
      : DEFAULT_LITELLM_CONFIG.provider;
    return {
      provider: validProvider,
      model: parsed.model || DEFAULT_LITELLM_CONFIG.model,
      apiKey: parsed.apiKey || parsed.api_key || "",
      baseUrl: parsed.baseUrl || parsed.base_url || "",
    };
  } catch {
    return DEFAULT_LITELLM_CONFIG;
  }
}

export function saveLiteLLMConfig(config: LiteLLMConfig) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LITELLM_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.error("Failed to save LiteLLM config to localStorage:", err);
  }
}

interface LiteLLMModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentConfig?: LiteLLMConfig;
  onSave: (config: LiteLLMConfig) => Promise<void> | void;
}

export function LiteLLMModal({
  isOpen,
  onClose,
  currentConfig,
  onSave,
}: LiteLLMModalProps) {
  const [provider, setProvider] = useState<LiteLLMProviderKey>(
    currentConfig?.provider || "gemini"
  );
  const [model, setModel] = useState<string>(
    currentConfig?.model || "gemini/gemini-2.5-flash"
  );
  const [customModel, setCustomModel] = useState<string>("");
  const [isCustomModel, setIsCustomModel] = useState<boolean>(false);
  const [apiKey, setApiKey] = useState<string>(currentConfig?.apiKey || "");
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [baseUrl, setBaseUrl] = useState<string>(currentConfig?.baseUrl || "");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  // Sync state when opened or currentConfig changes
  useEffect(() => {
    if (isOpen) {
      const active = currentConfig || loadLiteLLMConfig();
      const p = (active.provider in LITELLM_PROVIDERS) ? active.provider : "gemini";
      setProvider(p);
      setApiKey(active.apiKey || "");
      setBaseUrl(active.baseUrl || "");

      const providerInfo = LITELLM_PROVIDERS[p];
      if (providerInfo.models.includes(active.model)) {
        setModel(active.model);
        setIsCustomModel(false);
        setCustomModel("");
      } else {
        setModel("__custom__");
        setIsCustomModel(true);
        setCustomModel(active.model);
      }
      setStatusMessage(null);
    }
  }, [isOpen, currentConfig]);

  if (!isOpen) return null;

  const currentProviderInfo = LITELLM_PROVIDERS[provider] || LITELLM_PROVIDERS.gemini;

  function handleProviderChange(newProvider: LiteLLMProviderKey) {
    setProvider(newProvider);
    const pInfo = LITELLM_PROVIDERS[newProvider];
    // Reset to default model of new provider unless custom was actively typed
    if (!isCustomModel) {
      setModel(pInfo.defaultModel);
    }
    // Set default base URL if relevant
    if (pInfo.defaultBaseUrl && !baseUrl) {
      setBaseUrl(pInfo.defaultBaseUrl);
    }
    setStatusMessage(null);
  }

  function handleModelSelectChange(val: string) {
    if (val === "__custom__") {
      setIsCustomModel(true);
      if (!customModel) {
        setCustomModel(model !== "__custom__" ? model : "");
      }
    } else {
      setIsCustomModel(false);
      setModel(val);
    }
    setStatusMessage(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const finalModel = isCustomModel ? customModel.trim() : model.trim();
    if (!finalModel) {
      setStatusMessage({ text: "Please enter or select a model name.", type: "error" });
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    const payload: LiteLLMConfig = {
      provider,
      model: finalModel,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim() || undefined,
    };

    try {
      saveLiteLLMConfig(payload);
      await onSave(payload);
      setStatusMessage({ text: "Model configuration applied successfully!", type: "success" });
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (err: any) {
      setStatusMessage({
        text: err?.message || "Failed to sync model configuration with server.",
        type: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl rounded-2xl border border-white/15 bg-[#0a0c12] p-6 shadow-2xl space-y-5 max-h-[90vh] flex flex-col overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-gradient-to-br from-brand/20 via-brand/10 to-transparent text-2xl shadow-md">
              {currentProviderInfo.icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight text-white">
                  LiteLLM AI Provider & Model
                </h3>
                <Badge variant="default" className="text-[10px]">
                  Universal Gateway
                </Badge>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Route agent reasoning, tool execution, and context to your choice of foundation model.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white transition"
            aria-label="Close"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Feedback Alert */}
        {statusMessage && (
          <div
            className={`rounded-lg px-3.5 py-2.5 text-xs flex items-center gap-2 ${
              statusMessage.type === "success"
                ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                : "bg-red-500/15 border border-red-500/30 text-red-300"
            }`}
          >
            <span>{statusMessage.type === "success" ? "✓" : "⚠"}</span>
            <span>{statusMessage.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Provider Selection Dropdown */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-neutral-300 flex items-center justify-between">
              <span>AI Provider</span>
              <span className="text-[11px] font-normal text-neutral-400">
                {currentProviderInfo.badge}
              </span>
            </label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as LiteLLMProviderKey)}
              className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-sm text-neutral-100 shadow-sm focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
            >
              {(Object.keys(LITELLM_PROVIDERS) as LiteLLMProviderKey[]).map((key) => {
                const p = LITELLM_PROVIDERS[key];
                return (
                  <option key={key} value={key} className="bg-neutral-900 text-white">
                    {p.icon} {p.name}
                  </option>
                );
              })}
            </select>
            <p className="text-[11px] text-neutral-400">{currentProviderInfo.description}</p>
          </div>

          {/* Model Selector Dropdown */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-neutral-300 flex items-center justify-between">
              <span>Model Selector</span>
              <span className="text-[11px] text-neutral-500 font-mono">LiteLLM routing string</span>
            </label>
            <select
              value={isCustomModel ? "__custom__" : model}
              onChange={(e) => handleModelSelectChange(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-sm text-neutral-100 shadow-sm focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20"
            >
              {currentProviderInfo.models.map((m) => (
                <option key={m} value={m} className="bg-neutral-900 text-white">
                  {m}
                </option>
              ))}
              <option value="__custom__" className="bg-neutral-900 text-brand">
                ✍ Enter Custom Model string...
              </option>
            </select>

            {/* Custom Model Input (if selected or custom typed) */}
            {isCustomModel && (
              <div className="pt-2">
                <Input
                  type="text"
                  placeholder={`e.g. ${provider}/custom-model-id or hosted_vllm/...`}
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  className="font-mono text-xs"
                />
                <p className="text-[10px] text-neutral-500 mt-1">
                  Type any valid LiteLLM model identifier supported by your endpoint.
                </p>
              </div>
            )}
          </div>

          {/* API Key Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-neutral-300">
                {currentProviderInfo.name} API Key
              </label>
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="text-[11px] text-neutral-400 hover:text-white flex items-center gap-1 transition"
              >
                {showApiKey ? "Hide 👁" : "Show 👁‍🗨"}
              </button>
            </div>
            <div className="relative">
              <Input
                type={showApiKey ? "text" : "password"}
                placeholder={`Enter your ${currentProviderInfo.name} API Key (${currentProviderInfo.keyPlaceholder})`}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="font-mono text-xs pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2.5 top-2 text-neutral-500 hover:text-neutral-300"
                tabIndex={-1}
              >
                {showApiKey ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
                    />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-[11px] text-neutral-400">
              Stored securely per tenant session for direct LiteLLM model routing.
            </p>
          </div>

          {/* Custom Base URL (Optional) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-neutral-300">
                Custom Base URL <span className="font-normal text-neutral-500">(Optional)</span>
              </label>
              {currentProviderInfo.defaultBaseUrl && (
                <button
                  type="button"
                  onClick={() => setBaseUrl(currentProviderInfo.defaultBaseUrl || "")}
                  className="text-[10px] text-brand hover:underline"
                >
                  Set {currentProviderInfo.defaultBaseUrl}
                </button>
              )}
            </div>
            <Input
              type="text"
              placeholder={currentProviderInfo.defaultBaseUrl || "http://localhost:11434 or proxy URL"}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-neutral-400">
              Useful for self-hosted Ollama, vLLM, or corporate LiteLLM proxy gateways.
            </p>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-2.5 border-t border-white/10 pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={isSubmitting}
              className="gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeDashoffset="10" />
                  </svg>
                  Applying...
                </>
              ) : (
                <>Save & Apply Model ↗</>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
