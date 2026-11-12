// apps/web/components/litellm-modal.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  IconAlertTriangle,
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconClose,
  IconEye,
  IconEyeOff,
  IconSearch,
  IconTune,
  ProviderBrandIcon,
} from "@/components/ui/icons";
import { getJSON, post } from "@/lib/api";

export type LiteLLMProviderKey =
  | "gemini"
  | "openai"
  | "anthropic"
  | "deepseek"
  | "groq"
  | "ollama"
  | "mistral"
  | "openrouter"
  | "perplexity"
  | "together_ai"
  | "cohere"
  | "xai"
  | "azure"
  | "bedrock"
  | "vertex_ai"
  | "cloudflare"
  | "fireworks_ai"
  | "anyscale"
  | "replicate"
  | "custom"
  | string;

export interface LiteLLMProviderInfo {
  id: string;
  name: string;
  badge: string;
  defaultModel: string;
  models: string[];
  keyPlaceholder?: string;
  defaultBaseUrl?: string;
  description: string;
  env_key_name?: string;
  env_api_key_set?: boolean;
  requires_key?: boolean;
}

export const LITELLM_PROVIDERS: Record<string, LiteLLMProviderInfo> = {
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    badge: "Official Recommended",
    defaultModel: "gemini/gemini-2.5-flash",
    models: [
      "gemini/gemini-2.5-flash",
      "gemini/gemini-2.0-flash",
      "gemini/gemini-1.5-pro",
      "gemini/gemini-1.5-flash",
    ],
    keyPlaceholder: "AIzaSy...",
    defaultBaseUrl: "",
    description: "Ultra-fast multimodal reasoning with 1M+ token context window.",
    env_key_name: "GEMINI_API_KEY",
    requires_key: true,
  },
  openai: {
    id: "openai",
    name: "OpenAI",
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
    defaultBaseUrl: "",
    description: "Industry standard function calling and reasoning models.",
    env_key_name: "OPENAI_API_KEY",
    requires_key: true,
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic Claude",
    badge: "Advanced Analysis",
    defaultModel: "anthropic/claude-3-5-sonnet-20241022",
    models: [
      "anthropic/claude-3-5-sonnet-20241022",
      "anthropic/claude-3-5-haiku-20241022",
      "anthropic/claude-3-opus-20240229",
    ],
    keyPlaceholder: "sk-ant-...",
    defaultBaseUrl: "",
    description: "Top-tier complex coding, data synthesis, and tool execution.",
    env_key_name: "ANTHROPIC_API_KEY",
    requires_key: true,
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    badge: "High Performance / Value",
    defaultModel: "deepseek/deepseek-chat",
    models: [
      "deepseek/deepseek-chat",
      "deepseek/deepseek-reasoner",
    ],
    keyPlaceholder: "sk-...",
    defaultBaseUrl: "https://api.deepseek.com",
    description: "State-of-the-art open-weights model with reasoning capabilities.",
    env_key_name: "DEEPSEEK_API_KEY",
    requires_key: true,
  },
  groq: {
    id: "groq",
    name: "Groq LPU",
    badge: "Ultra Low Latency",
    defaultModel: "groq/llama-3.3-70b-versatile",
    models: [
      "groq/llama-3.3-70b-versatile",
      "groq/llama-3.1-8b-instant",
      "groq/mixtral-8x7b-32768",
    ],
    keyPlaceholder: "gsk_...",
    defaultBaseUrl: "",
    description: "Sub-second LPU inference speeds for real-time agent loops.",
    env_key_name: "GROQ_API_KEY",
    requires_key: true,
  },
  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    badge: "Self-Hosted / Air-Gapped",
    defaultModel: "ollama/qwen2.5",
    models: [
      "ollama/qwen2.5",
      "ollama/llama3.1",
      "ollama/mistral",
      "ollama/deepseek-r1",
    ],
    keyPlaceholder: "Optional token",
    defaultBaseUrl: "http://localhost:11434",
    description: "On-premise zero-data-leakage inference on local hardware.",
    requires_key: false,
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    badge: "European Sovereign AI",
    defaultModel: "mistral/mistral-large-latest",
    models: [
      "mistral/mistral-large-latest",
      "mistral/codestral-latest",
      "mistral/mistral-small-latest",
    ],
    keyPlaceholder: "...",
    defaultBaseUrl: "",
    description: "High efficiency enterprise models for industrial agents.",
    env_key_name: "MISTRAL_API_KEY",
    requires_key: true,
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    badge: "Unified Aggregator",
    defaultModel: "openrouter/anthropic/claude-3.5-sonnet",
    models: [
      "openrouter/anthropic/claude-3.5-sonnet",
      "openrouter/openai/gpt-4o",
      "openrouter/meta-llama/llama-3.3-70b-instruct",
      "openrouter/deepseek/deepseek-r1",
    ],
    keyPlaceholder: "sk-or-...",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    description: "Unified aggregator API routing to 200+ global foundation models.",
    env_key_name: "OPENROUTER_API_KEY",
    requires_key: true,
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity AI",
    badge: "Real-time Search",
    defaultModel: "perplexity/sonar-pro",
    models: [
      "perplexity/sonar-pro",
      "perplexity/sonar",
      "perplexity/sonar-reasoning",
    ],
    keyPlaceholder: "pplx-...",
    defaultBaseUrl: "https://api.perplexity.ai",
    description: "Online grounded reasoning with real-time web retrieval.",
    env_key_name: "PERPLEXITY_API_KEY",
    requires_key: true,
  },
  together_ai: {
    id: "together_ai",
    name: "Together AI",
    badge: "Fast Open Source",
    defaultModel: "together_ai/meta-llama/Llama-3.3-70B-Instruct-Turbo",
    models: [
      "together_ai/meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "together_ai/mistralai/Mixtral-8x22B-Instruct-v0.1",
      "together_ai/deepseek-ai/DeepSeek-R1",
    ],
    keyPlaceholder: "together-...",
    defaultBaseUrl: "https://api.together.xyz/v1",
    description: "High-throughput cloud inference for open-weights models.",
    env_key_name: "TOGETHER_API_KEY",
    requires_key: true,
  },
  cohere: {
    id: "cohere",
    name: "Cohere",
    badge: "Enterprise RAG",
    defaultModel: "cohere/command-r-plus",
    models: [
      "cohere/command-r-plus",
      "cohere/command-r",
      "cohere/command-light",
    ],
    keyPlaceholder: "...",
    defaultBaseUrl: "https://api.cohere.com/v1",
    description: "Enterprise foundation models optimized for retrieval and grounded workflows.",
    env_key_name: "COHERE_API_KEY",
    requires_key: true,
  },
  xai: {
    id: "xai",
    name: "xAI / Grok",
    badge: "Frontier Reasoning",
    defaultModel: "xai/grok-2-latest",
    models: [
      "xai/grok-2-latest",
      "xai/grok-beta",
    ],
    keyPlaceholder: "xai-...",
    defaultBaseUrl: "https://api.x.ai/v1",
    description: "Real-time knowledge integration and frontier reasoning capabilities.",
    env_key_name: "XAI_API_KEY",
    requires_key: true,
  },
  azure: {
    id: "azure",
    name: "Azure OpenAI",
    badge: "Enterprise Cloud",
    defaultModel: "azure/gpt-4o",
    models: [
      "azure/gpt-4o",
      "azure/gpt-4o-mini",
      "azure/gpt-4-turbo",
    ],
    keyPlaceholder: "Azure API Key",
    defaultBaseUrl: "https://{resource}.openai.azure.com",
    description: "Enterprise Azure hosted OpenAI endpoints with strict compliance.",
    env_key_name: "AZURE_API_KEY",
    requires_key: true,
  },
  bedrock: {
    id: "bedrock",
    name: "AWS Bedrock",
    badge: "AWS Sovereign",
    defaultModel: "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0",
    models: [
      "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0",
      "bedrock/amazon.nova-pro-v1:0",
      "bedrock/meta.llama3-70b-instruct-v1:0",
    ],
    keyPlaceholder: "AWS Access Key",
    defaultBaseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    description: "Fully managed foundation models hosted within AWS infrastructure.",
    env_key_name: "AWS_ACCESS_KEY_ID",
    requires_key: true,
  },
  vertex_ai: {
    id: "vertex_ai",
    name: "Google Vertex AI",
    badge: "GCP Managed",
    defaultModel: "vertex_ai/gemini-2.0-flash",
    models: [
      "vertex_ai/gemini-2.0-flash",
      "vertex_ai/gemini-1.5-pro",
      "vertex_ai/gemini-1.5-flash",
    ],
    keyPlaceholder: "GCP Service Token or ADC",
    defaultBaseUrl: "https://{region}-aiplatform.googleapis.com",
    description: "Enterprise Google Cloud Vertex AI deployment with VPC Service Controls.",
    env_key_name: "VERTEXAI_PROJECT",
    requires_key: true,
  },
  cloudflare: {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    badge: "Edge Compute",
    defaultModel: "cloudflare/@cf/meta/llama-3.3-70b-instruct",
    models: [
      "cloudflare/@cf/meta/llama-3.3-70b-instruct",
      "cloudflare/@cf/mistral/mistral-7b-instruct-v0.2",
    ],
    keyPlaceholder: "Cloudflare API Token",
    defaultBaseUrl: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run",
    description: "Serverless server-side AI execution on Cloudflare global edge network.",
    env_key_name: "CLOUDFLARE_API_KEY",
    requires_key: true,
  },
  fireworks_ai: {
    id: "fireworks_ai",
    name: "Fireworks AI",
    badge: "Fast Open Source",
    defaultModel: "fireworks_ai/accounts/fireworks/models/llama-v3p3-70b-instruct",
    models: [
      "fireworks_ai/accounts/fireworks/models/llama-v3p3-70b-instruct",
      "fireworks_ai/accounts/fireworks/models/mixtral-8x22b-instruct",
    ],
    keyPlaceholder: "fw_...",
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    description: "Ultra-fast open weights inference engine.",
    env_key_name: "FIREWORKS_API_KEY",
    requires_key: true,
  },
  anyscale: {
    id: "anyscale",
    name: "Anyscale",
    badge: "Scalable Ray",
    defaultModel: "anyscale/meta-llama/Meta-Llama-3-70B-Instruct",
    models: [
      "anyscale/meta-llama/Meta-Llama-3-70B-Instruct",
      "anyscale/mistralai/Mixtral-8x7B-Instruct-v0.1",
    ],
    keyPlaceholder: "secret_...",
    defaultBaseUrl: "https://api.anyscale.com/v1",
    description: "Enterprise scalable LLM inference powered by Ray.",
    env_key_name: "ANYSCALE_API_KEY",
    requires_key: true,
  },
  replicate: {
    id: "replicate",
    name: "Replicate",
    badge: "Cloud Model Zoo",
    defaultModel: "replicate/meta/meta-llama-3-70b-instruct",
    models: [
      "replicate/meta/meta-llama-3-70b-instruct",
      "replicate/mistralai/mixtral-8x7b-instruct-v0.1",
    ],
    keyPlaceholder: "r8_...",
    defaultBaseUrl: "https://api.replicate.com/v1",
    description: "Run open-source machine learning models in the cloud with an API.",
    env_key_name: "REPLICATE_API_TOKEN",
    requires_key: true,
  },
  custom: {
    id: "custom",
    name: "Custom LiteLLM Proxy / vLLM",
    badge: "Enterprise Gateway",
    defaultModel: "custom/my-model",
    models: [
      "custom/my-model",
      "custom/enterprise-llm",
    ],
    keyPlaceholder: "Bearer token or secret",
    defaultBaseUrl: "http://localhost:4000",
    description: "Direct routing to your centralized LiteLLM proxy, vLLM, or self-hosted server.",
    requires_key: false,
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
export const LITELLM_KEYS_STORAGE_KEY = "cawrys_litellm_saved_keys";
export const LITELLM_CONFIG_EVENT = "cawrys:litellm_config_changed";

export function loadLiteLLMConfig(): LiteLLMConfig {
  if (typeof window === "undefined") return DEFAULT_LITELLM_CONFIG;
  try {
    const raw = localStorage.getItem(LITELLM_STORAGE_KEY);
    if (!raw) return DEFAULT_LITELLM_CONFIG;
    const parsed = JSON.parse(raw);
    const validProvider = parsed.provider || DEFAULT_LITELLM_CONFIG.provider;
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
    if (config.provider && config.apiKey) {
      const keysRaw = localStorage.getItem(LITELLM_KEYS_STORAGE_KEY);
      const keys = keysRaw ? JSON.parse(keysRaw) : {};
      keys[config.provider] = config.apiKey;
      localStorage.setItem(LITELLM_KEYS_STORAGE_KEY, JSON.stringify(keys));
    }
    // Broadcast config update to all components
    window.dispatchEvent(
      new CustomEvent(LITELLM_CONFIG_EVENT, { detail: config })
    );
  } catch (err) {
    console.error("Failed to save LiteLLM config to localStorage:", err);
  }
}

export function loadSavedProviderKey(providerId: string): string {
  if (typeof window === "undefined") return "";
  try {
    const keysRaw = localStorage.getItem(LITELLM_KEYS_STORAGE_KEY);
    if (!keysRaw) return "";
    const keys = JSON.parse(keysRaw);
    return keys[providerId] || "";
  } catch {
    return "";
  }
}

interface LiteLLMModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentConfig?: LiteLLMConfig;
  onSave: (config: LiteLLMConfig) => Promise<void> | void;
  role?: string;
  readOnly?: boolean;
}

export function LiteLLMModal({
  isOpen,
  onClose,
  currentConfig,
  onSave,
  role,
  readOnly,
}: LiteLLMModalProps) {
  const isEngineer = role === "engineer" || Boolean(readOnly);
  const [providerList, setProviderList] = useState<Record<string, LiteLLMProviderInfo>>(LITELLM_PROVIDERS);
  const [providerSearch, setProviderSearch] = useState<string>("");
  const [isProviderDropdownOpen, setIsProviderDropdownOpen] = useState<boolean>(false);

  const [provider, setProvider] = useState<string>(
    currentConfig?.provider || "gemini"
  );
  const [model, setModel] = useState<string>(
    currentConfig?.model || "gemini/gemini-2.5-flash"
  );
  const [modelSearch, setModelSearch] = useState<string>("");
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState<boolean>(false);
  const [dynamicModels, setDynamicModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState<boolean>(false);

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

  const providerDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch providers catalog dynamically from execution API
  useEffect(() => {
    async function fetchProvidersCatalog() {
      try {
        const res = await getJSON<any>("/api/execution/v1/chat/providers");
        const list: any[] = Array.isArray(res)
          ? res
          : Array.isArray(res?.providers)
          ? res.providers
          : res?.providers && typeof res.providers === "object"
          ? Object.values(res.providers)
          : [];

        if (list.length > 0) {
          const merged: Record<string, LiteLLMProviderInfo> = { ...LITELLM_PROVIDERS };
          for (const item of list) {
            const pid = item.id || item.provider || item.name?.toLowerCase();
            if (!pid) continue;
            merged[pid] = {
              id: pid,
              name: item.name || merged[pid]?.name || pid,
              badge: merged[pid]?.badge || (item.env_api_key_set ? "Pre-configured" : "Cloud Provider"),
              defaultModel: item.default_model || item.defaultModel || merged[pid]?.defaultModel || `${pid}/default`,
              models: Array.isArray(item.models) && item.models.length > 0
                ? item.models
                : Array.isArray(item.popular_models) && item.popular_models.length > 0
                ? item.popular_models
                : merged[pid]?.models || [item.default_model || `${pid}/default`],
              keyPlaceholder: item.key_prefix ? `${item.key_prefix}...` : merged[pid]?.keyPlaceholder || "API Key",
              defaultBaseUrl: item.default_base_url ?? merged[pid]?.defaultBaseUrl ?? "",
              description: item.description || merged[pid]?.description || `LiteLLM integration for ${item.name || pid}.`,
              env_key_name: item.env_key_name || merged[pid]?.env_key_name,
              env_api_key_set: item.env_api_key_set ?? merged[pid]?.env_api_key_set,
              requires_key: item.requires_key ?? merged[pid]?.requires_key,
            };
          }
          setProviderList(merged);
        }
      } catch {
        // Keep static fallback catalog
      }
    }

    if (isOpen) {
      fetchProvidersCatalog();
    }
  }, [isOpen]);

  // Sync state when opened or currentConfig changes
  useEffect(() => {
    if (isOpen) {
      const active = currentConfig || loadLiteLLMConfig();
      const p = active.provider || "gemini";
      setProvider(p);
      setApiKey(active.apiKey || loadSavedProviderKey(p) || "");
      setBaseUrl(active.baseUrl || "");

      const providerInfo = providerList[p] || LITELLM_PROVIDERS[p];
      const knownModels = providerInfo ? providerInfo.models : [];
      if (knownModels.includes(active.model)) {
        setModel(active.model);
        setIsCustomModel(false);
        setCustomModel("");
      } else {
        setModel(active.model || providerInfo?.defaultModel || "");
        setIsCustomModel(false);
        setCustomModel("");
      }
      setStatusMessage(null);
      setIsProviderDropdownOpen(false);
      setIsModelDropdownOpen(false);

      // Trigger dynamic model fetch on mount for this provider
      fetchDynamicModels(p, active.apiKey || loadSavedProviderKey(p), active.baseUrl);
    }
  }, [isOpen, currentConfig]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        providerDropdownRef.current &&
        !providerDropdownRef.current.contains(event.target as Node)
      ) {
        setIsProviderDropdownOpen(false);
      }
      if (
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(event.target as Node)
      ) {
        setIsModelDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentProviderInfo: LiteLLMProviderInfo =
    providerList[provider] ||
    LITELLM_PROVIDERS[provider] || {
      id: provider,
      name: provider,
      badge: "Provider",
      defaultModel: `${provider}/default`,
      models: [`${provider}/default`],
      description: `Inference routing for ${provider}.`,
      keyPlaceholder: "API Key",
    };

  // Dynamically fetch models from backend execution endpoint
  async function fetchDynamicModels(pId: string, key?: string, bUrl?: string) {
    setIsFetchingModels(true);
    try {
      const res = await post<any>("/api/execution/v1/chat/models/fetch", {
        provider: pId,
        api_key: key || undefined,
        base_url: bUrl || undefined,
      });

      const list: any[] = Array.isArray(res)
        ? res
        : Array.isArray(res?.models)
        ? res.models
        : [];

      if (list.length > 0) {
        const modelNames = list.map((m: any) =>
          typeof m === "string" ? m : m.id || m.name
        ).filter(Boolean);
        if (modelNames.length > 0) {
          setDynamicModels(modelNames);
          return;
        }
      }
      // Fallback to provider info catalog models
      const fallback = providerList[pId]?.models || LITELLM_PROVIDERS[pId]?.models || [];
      setDynamicModels(fallback);
    } catch {
      // Graceful fallback to catalog models
      const fallback = providerList[pId]?.models || LITELLM_PROVIDERS[pId]?.models || [];
      setDynamicModels(fallback);
    } finally {
      setIsFetchingModels(false);
    }
  }

  // Handle provider selection
  function handleSelectProvider(newProvider: string) {
    setProvider(newProvider);
    setIsProviderDropdownOpen(false);
    setProviderSearch("");

    const pInfo = providerList[newProvider] || LITELLM_PROVIDERS[newProvider];
    const newBaseUrl = pInfo?.defaultBaseUrl || "";
    setBaseUrl(newBaseUrl);

    // Prefill saved API key for this provider if present in localStorage
    const savedKey = loadSavedProviderKey(newProvider);
    if (savedKey) {
      setApiKey(savedKey);
    } else if (pInfo?.env_api_key_set) {
      setApiKey(""); // Env key will be utilized automatically by backend
    }

    // Set default model of new provider
    const defModel = pInfo?.defaultModel || (pInfo?.models?.[0] ?? `${newProvider}/default`);
    setModel(defModel);
    setIsCustomModel(false);
    setCustomModel("");
    setStatusMessage(null);

    // Automatically trigger dynamic model fetching for the selected provider
    fetchDynamicModels(newProvider, savedKey, newBaseUrl);
  }

  // Handle model selection
  function handleSelectModel(selectedModel: string) {
    if (selectedModel === "__custom__") {
      setIsCustomModel(true);
      if (!customModel) {
        setCustomModel(model !== "__custom__" ? model : "");
      }
    } else {
      setIsCustomModel(false);
      setModel(selectedModel);
    }
    setIsModelDropdownOpen(false);
    setModelSearch("");
    setStatusMessage(null);
  }

  // Filtered providers
  const filteredProviders = useMemo(() => {
    const list = Object.values(providerList);
    if (!providerSearch.trim()) return list;
    const q = providerSearch.toLowerCase().trim();
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        (p.badge && p.badge.toLowerCase().includes(q))
    );
  }, [providerList, providerSearch]);

  // Combined models list (dynamic models or catalog models)
  const availableModels = useMemo(() => {
    const catalog = currentProviderInfo.models || [];
    const set = new Set<string>();
    for (const m of dynamicModels) set.add(m);
    for (const m of catalog) set.add(m);
    if (currentProviderInfo.defaultModel) set.add(currentProviderInfo.defaultModel);
    return Array.from(set);
  }, [dynamicModels, currentProviderInfo]);

  // Filtered models
  const filteredModels = useMemo(() => {
    if (!modelSearch.trim()) return availableModels;
    const q = modelSearch.toLowerCase().trim();
    return availableModels.filter((m) => m.toLowerCase().includes(q));
  }, [availableModels, modelSearch]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const finalModel = isCustomModel ? customModel.trim() : model.trim();
    if (!finalModel) {
      setStatusMessage({ text: "Please enter or select a model identifier.", type: "error" });
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
      setStatusMessage({ text: "Model configuration applied and synchronized.", type: "success" });
      setTimeout(() => {
        onClose();
      }, 400);
    } catch (err: any) {
      setStatusMessage({
        text: err?.message || "Failed to sync model configuration with execution backend.",
        type: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/40 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xl space-y-5 max-h-[92vh] flex flex-col overflow-y-auto text-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-50 text-neutral-900 shadow-sm">
              <ProviderBrandIcon provider={provider} className="h-6 w-6 text-neutral-900" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight text-neutral-900">
                  LiteLLM AI Provider &amp; Model
                </h3>
                <Badge variant="secondary" className="text-[10px]">
                  Universal Gateway
                </Badge>
              </div>
              <p className="text-xs text-neutral-500 mt-0.5">
                Route agent reasoning, tool execution, and context to your choice of foundation model.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 transition"
            aria-label="Close modal"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        {/* Feedback Alert */}
        {isEngineer && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-amber-600 shrink-0 mt-0.5">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <div>
              <span className="font-semibold text-amber-950">Configured by Administrator</span>
              <p className="mt-0.5 text-neutral-700 leading-relaxed">
                On-site engineers have view-only access to AI model configuration. AI provider, model selection, API key, and base URL are managed by your administrator.
              </p>
            </div>
          </div>
        )}

        {statusMessage && (
          <div
            className={`rounded-xl px-3.5 py-2.5 text-xs flex items-center gap-2 ${
              statusMessage.type === "success"
                ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                : "bg-rose-50 border border-rose-200 text-rose-800"
            }`}
          >
            {statusMessage.type === "success" ? (
              <IconCheck className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <IconAlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Searchable Provider Selector */}
          <div className="space-y-1.5" ref={providerDropdownRef}>
            <label className="text-xs font-semibold text-neutral-700 flex items-center justify-between">
              <span>AI Provider</span>
              <span className="text-[11px] font-normal text-neutral-400">
                {currentProviderInfo.badge}
              </span>
            </label>

            {/* Provider selector trigger button */}
            <div className="relative">
              <button
                type="button"
                disabled={isEngineer}
                onClick={() => !isEngineer && setIsProviderDropdownOpen(!isProviderDropdownOpen)}
                className={`w-full flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-900 shadow-xs transition ${
                  isEngineer ? "cursor-not-allowed opacity-70" : "hover:border-neutral-300 focus:border-neutral-900 focus:outline-none"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <ProviderBrandIcon provider={currentProviderInfo.id} className="h-4 w-4 text-neutral-900 shrink-0" />
                  <span className="font-semibold text-neutral-900 truncate">{currentProviderInfo.name}</span>
                  <span className="text-neutral-400 text-xs font-mono">({currentProviderInfo.id})</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {currentProviderInfo.env_api_key_set && (
                    <Badge variant="success" className="text-[9px] py-0 px-1.5">
                      Env Ready
                    </Badge>
                  )}
                  <IconChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${isProviderDropdownOpen ? "rotate-180" : ""}`} />
                </div>
              </button>

              {/* Provider Dropdown Panel */}
              {isProviderDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-2xl border border-neutral-200 bg-white p-2 shadow-2xl space-y-2 max-h-72 flex flex-col text-neutral-900">
                  {/* Search Input */}
                  <div className="relative">
                    <IconSearch className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-neutral-400" />
                    <Input
                      type="text"
                      placeholder="Search providers (e.g. Gemini, OpenAI, Groq, Ollama)..."
                      value={providerSearch}
                      onChange={(e) => setProviderSearch(e.target.value)}
                      className="pl-8 text-xs h-8 bg-neutral-50 border-neutral-200"
                      autoFocus
                    />
                  </div>

                  {/* Provider List */}
                  <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                    {filteredProviders.length === 0 ? (
                      <div className="p-3 text-center text-xs text-neutral-500">
                        No AI providers match &ldquo;{providerSearch}&rdquo;
                      </div>
                    ) : (
                      filteredProviders.map((p) => {
                        const isSelected = p.id === provider;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => handleSelectProvider(p.id)}
                            className={`w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs transition ${
                              isSelected
                                ? "bg-neutral-950 text-white font-medium"
                                : "text-neutral-800 hover:bg-neutral-100"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <ProviderBrandIcon provider={p.id} className={`h-4 w-4 shrink-0 ${isSelected ? "text-white" : "text-neutral-900"}`} />
                              <div className="min-w-0">
                                <div className="font-semibold truncate flex items-center gap-1.5">
                                  <span>{p.name}</span>
                                  {isSelected && <IconCheck className="h-3 w-3 text-white shrink-0" />}
                                </div>
                                <div className={`text-[10px] truncate ${isSelected ? "text-neutral-300" : "text-neutral-500"}`}>{p.description}</div>
                              </div>
                            </div>
                            <div className="shrink-0 ml-2 text-right">
                              {p.env_api_key_set ? (
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700 border border-emerald-200">
                                  Configured
                                </span>
                              ) : p.requires_key === false ? (
                                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[9px] text-neutral-600">
                                  No Key
                                </span>
                              ) : (
                                <span className="text-[10px] text-neutral-400 font-mono">
                                  {p.id}
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
            <p className="text-[11px] text-neutral-500">{currentProviderInfo.description}</p>
          </div>

          {/* Searchable Model Selector */}
          <div className="space-y-1.5" ref={modelDropdownRef}>
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-neutral-700">
                Model Selector
              </label>
              <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                {isFetchingModels ? (
                  <span className="flex items-center gap-1 text-neutral-900">
                    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeDashoffset="10" />
                    </svg>
                    <span>Fetching models...</span>
                  </span>
                ) : (
                  <span className="font-mono text-neutral-400">
                    {availableModels.length} models available
                  </span>
                )}
              </div>
            </div>

            {/* Model selector trigger button */}
            <div className="relative">
              <button
                type="button"
                disabled={isEngineer}
                onClick={() => !isEngineer && setIsModelDropdownOpen(!isModelDropdownOpen)}
                className={`w-full flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-900 shadow-xs transition ${
                  isEngineer ? "cursor-not-allowed opacity-70" : "hover:border-neutral-300 focus:border-neutral-900 focus:outline-none"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs font-semibold text-neutral-900 truncate">
                    {isCustomModel ? (customModel || "Custom model string") : model}
                  </span>
                </div>
                <IconChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${isModelDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {/* Model Dropdown Panel */}
              {!isEngineer && isModelDropdownOpen && (
                <div className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-2xl border border-neutral-200 bg-white p-2 shadow-2xl space-y-2 max-h-72 flex flex-col text-neutral-900">
                  {/* Search Input */}
                  <div className="relative">
                    <IconSearch className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-neutral-400" />
                    <Input
                      type="text"
                      placeholder="Search models (e.g. gpt-4o, claude-3-5, gemini-2.5, llama)..."
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      className="pl-8 text-xs h-8 bg-neutral-50 border-neutral-200"
                      autoFocus
                    />
                  </div>

                  {/* Models List */}
                  <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                    {filteredModels.length === 0 ? (
                      <div className="p-3 text-center text-xs text-neutral-500">
                        No models match &ldquo;{modelSearch}&rdquo;
                      </div>
                    ) : (
                      filteredModels.map((m) => {
                        const isSelected = !isCustomModel && m === model;
                        const isDefault = m === currentProviderInfo.defaultModel;
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => handleSelectModel(m)}
                            className={`w-full flex items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs transition ${
                              isSelected
                                ? "bg-neutral-950 text-white font-medium"
                                : "text-neutral-800 hover:bg-neutral-100"
                            }`}
                          >
                            <span className="font-mono text-xs truncate flex items-center gap-1.5">
                              <span>{m}</span>
                              {isSelected && <IconCheck className="h-3 w-3 text-white shrink-0" />}
                            </span>
                            {isDefault && (
                              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[9px] font-semibold text-neutral-700 border border-neutral-200 shrink-0">
                                Default
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}

                    {/* Custom Model Option */}
                    <div className="border-t border-neutral-100 pt-1 mt-1">
                      <button
                        type="button"
                        onClick={() => handleSelectModel("__custom__")}
                        className={`w-full flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition ${
                          isCustomModel
                            ? "bg-neutral-950 text-white font-medium"
                            : "text-neutral-900 hover:bg-neutral-100"
                        }`}
                      >
                        <IconTune className="h-3.5 w-3.5 shrink-0" />
                        <span>Enter custom model identifier...</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Custom Model Text Input (if selected) */}
            {isCustomModel && (
              <div className="pt-2">
                <Input
                  type="text"
                  disabled={isEngineer}
                  placeholder={`e.g. ${provider}/custom-model-name or hosted_vllm/...`}
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  className="font-mono text-xs"
                />
                <p className="text-[10px] text-neutral-400 mt-1">
                  Type any valid LiteLLM model identifier supported by your endpoint.
                </p>
              </div>
            )}
          </div>

          {/* API Key Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-semibold text-neutral-700">
                  {currentProviderInfo.name} API Key
                </label>
                {currentProviderInfo.env_api_key_set && (
                  <Badge variant="success" className="text-[9px] py-0 px-1.5">
                    Pre-configured in Environment
                  </Badge>
                )}
                {isEngineer && (
                  <Badge variant="warning" className="text-[9px] py-0 px-1.5">
                    Configured by Administrator
                  </Badge>
                )}
              </div>
              {!isEngineer && (
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="text-[11px] text-neutral-500 hover:text-neutral-900 flex items-center gap-1 transition"
                >
                  {showApiKey ? (
                    <>
                      <IconEyeOff className="h-3.5 w-3.5" />
                      <span>Hide</span>
                    </>
                  ) : (
                    <>
                      <IconEye className="h-3.5 w-3.5" />
                      <span>Show</span>
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="relative">
              <Input
                type={showApiKey ? "text" : "password"}
                disabled={isEngineer}
                placeholder={
                  isEngineer
                    ? "Configured by Administrator (Locked)"
                    : currentProviderInfo.env_api_key_set
                    ? `Pre-configured via ${currentProviderInfo.env_key_name || "Environment"} (leave blank or override)`
                    : `Enter ${currentProviderInfo.name} API Key (${currentProviderInfo.keyPlaceholder || "Required"})`
                }
                value={isEngineer ? "••••••••••••••••" : apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className={`font-mono text-xs pr-10 ${isEngineer ? "cursor-not-allowed opacity-70 bg-neutral-100" : ""}`}
              />
              {!isEngineer && (
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-2.5 text-neutral-400 hover:text-neutral-700"
                  tabIndex={-1}
                  aria-label={showApiKey ? "Hide API key" : "Show API key"}
                >
                  {showApiKey ? (
                    <IconEyeOff className="h-4 w-4" />
                  ) : (
                    <IconEye className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
            <p className="text-[11px] text-neutral-500">
              {isEngineer
                ? "Credential secured and managed centrally by system administrator."
                : "Stored securely per tenant session for direct LiteLLM model routing."}
            </p>
          </div>

          {/* Custom Base URL (Optional) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-neutral-700">
                Custom Base URL <span className="font-normal text-neutral-400">(Optional)</span>
              </label>
              {!isEngineer && currentProviderInfo.defaultBaseUrl && (
                <button
                  type="button"
                  onClick={() => setBaseUrl(currentProviderInfo.defaultBaseUrl || "")}
                  className="text-[10px] text-neutral-900 hover:underline font-mono"
                >
                  Set default: {currentProviderInfo.defaultBaseUrl}
                </button>
              )}
            </div>
            <Input
              type="text"
              disabled={isEngineer}
              placeholder={
                isEngineer
                  ? "Configured by Administrator (Standard Endpoint)"
                  : currentProviderInfo.defaultBaseUrl || "http://localhost:11434 or proxy URL"
              }
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className={`font-mono text-xs ${isEngineer ? "cursor-not-allowed opacity-70 bg-neutral-100" : ""}`}
            />
            <p className="text-[11px] text-neutral-500">
              Useful for self-hosted Ollama, vLLM, Azure endpoints, or corporate LiteLLM proxy gateways.
            </p>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-2.5 border-t border-neutral-100 pt-4">
            {isEngineer ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                className="w-full text-xs"
              >
                Close (Configured by Administrator)
              </Button>
            ) : (
              <>
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
                  className="gap-1.5 bg-neutral-950 hover:bg-neutral-800 text-white"
                >
                  {isSubmitting ? (
                    <>
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="12" cy="12" r="10" strokeDasharray="30" strokeDashoffset="10" />
                      </svg>
                      <span>Applying...</span>
                    </>
                  ) : (
                    <>
                      <IconBolt className="h-3.5 w-3.5" />
                      <span>Save &amp; Apply Model</span>
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
