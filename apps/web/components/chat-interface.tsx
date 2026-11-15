// apps/web/components/chat-interface.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { API, getJSON, post } from "@/lib/api";
import {
  DEFAULT_LITELLM_CONFIG,
  LITELLM_CONFIG_EVENT,
  LITELLM_PROVIDERS,
  LiteLLMConfig,
  LiteLLMProviderInfo,
  loadLiteLLMConfig,
  loadSavedProviderKey,
  saveLiteLLMConfig,
} from "./litellm-modal";
import {
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconFile,
  IconSearch,
} from "@/components/ui/icons";

type ToolCall = {
  app: string;
  tool: string;
  connector: string;
  params: Record<string, any>;
  data: any;
};

type StoredDoc = {
  id: string;
  filename: string;
  status: string;
  created_at: string;
  doc_type?: string | null;
  confidence?: number | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls?: ToolCall[];
  dashboard_mutated?: boolean;
  overrides?: Record<string, any>;
  metadata?: Record<string, any>;
  timestamp?: string;
  created_at?: string;
};

type ConnectedTool = {
  name: string;
  description: string;
  connector: string;
  risk: string;
};

type MarketplaceConnection = {
  app_key: string;
  app_name: string;
  status: string;
  auth_mode: string;
};

type ChatInterfaceProps = {
  role: string;
  initialTools?: ConnectedTool[];
  initialConnections?: MarketplaceConnection[];
  initialOverrides?: Record<string, any>;
  initialDocsCount?: number;
};

const QUICK_ACTION_CARDS = [
  {
    title: "Check SAP stock for Part 100",
    subtitle: "Query SAP S/4HANA inventory, storage locations & lead times",
    prompt: "Check SAP S/4HANA stock levels for Part 100 in plant 1000",
    tag: "ERP / Inventory",
  },
  {
    title: "Review Siemens CAD rev",
    subtitle: "Audit Teamcenter drawing DWG-4002 revisions & engineering BOM",
    prompt: "Check Siemens CAD revisions for DWG-4002 and summarize BOM status",
    tag: "Engineering PLM",
  },
  {
    title: "Query CNC telemetry",
    subtitle: "Inspect live spindle speed, vibration index & motor temperatures",
    prompt: "Query CNC machine telemetry and evaluate spindle vibration risk",
    tag: "FastMCP IIoT",
  },
  {
    title: "Adjust production target",
    subtitle: "Update live shift quota to 1,200 units with optimal OEE",
    prompt: "Update dashboard production target to 1,200 units and set operational status to Optimal",
    tag: "Live Dashboard",
  },
];

const QUICK_PROVIDER_IDS = [
  "gemini",
  "openai",
  "anthropic",
  "openrouter",
  "deepseek",
  "groq",
  "ollama",
  "xai",
  "mistral",
];

const PROVIDER_SHORT_NAMES: Record<string, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  groq: "Groq",
  ollama: "Ollama",
  mistral: "Mistral",
  openrouter: "OpenRouter",
  perplexity: "Perplexity",
  together_ai: "Together",
  cohere: "Cohere",
  xai: "xAI",
  azure: "Azure",
  bedrock: "Bedrock",
  vertex_ai: "Vertex AI",
  cloudflare: "Cloudflare",
  fireworks_ai: "Fireworks",
  anyscale: "Anyscale",
  replicate: "Replicate",
  custom: "Custom",
};

function formatTime(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatProviderShortName(providerId: string, fullName?: string): string {
  if (PROVIDER_SHORT_NAMES[providerId]) return PROVIDER_SHORT_NAMES[providerId];
  return fullName || providerId;
}

function formatModelShortName(modelId: string): string {
  if (!modelId) return "default";
  const parts = modelId.split("/");
  return parts[parts.length - 1] || modelId;
}

export function ChatInterface({
  role,
  initialTools = [],
  initialConnections = [],
  initialOverrides = {},
  initialDocsCount = 0,
}: ChatInterfaceProps) {
  const isEngineer = role === "engineer";
  const canUpload = role !== "viewer";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [connections, setConnections] = useState<MarketplaceConnection[]>(initialConnections);
  const [overrides, setOverrides] = useState<Record<string, any>>(initialOverrides);
  const [docsCount, setDocsCount] = useState<number>(initialDocsCount);
  const [modelConfig, setModelConfig] = useState<LiteLLMConfig>(DEFAULT_LITELLM_CONFIG);
  const [showToolDetails, setShowToolDetails] = useState<Record<string, boolean>>({});

  // Stored workspace documents & attached chips
  const [storedDocs, setStoredDocs] = useState<StoredDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<StoredDoc[]>([]);

  // Composer "+" add/upload popover state
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Composer small model capsule popover state
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [activeProviderTab, setActiveProviderTab] = useState<string>(DEFAULT_LITELLM_CONFIG.provider);
  const [providerCatalog, setProviderCatalog] = useState<Record<string, LiteLLMProviderInfo>>(LITELLM_PROVIDERS);
  const [fetchedModelsByProvider, setFetchedModelsByProvider] = useState<Record<string, string[]>>({});
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  // Check URL query parameters for ?configure_ai=1 or ?litellm=1 (non-engineers only)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      if ((sp.get("configure_ai") === "1" || sp.get("litellm") === "1") && !isEngineer) {
        setIsModelMenuOpen(true);
      }
    }
  }, [isEngineer]);

  // Close popovers on outside click or Escape key
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (addMenuRef.current && !addMenuRef.current.contains(target)) {
        setIsAddMenuOpen(false);
      }
      if (modelMenuRef.current && !modelMenuRef.current.contains(target)) {
        setIsModelMenuOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsAddMenuOpen(false);
        setIsModelMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  // Listen for LiteLLM config updates from /settings or other tabs
  useEffect(() => {
    function handleConfigChange(e: Event) {
      const customEvent = e as CustomEvent<LiteLLMConfig>;
      if (customEvent.detail) {
        setModelConfig(customEvent.detail);
        setActiveProviderTab(customEvent.detail.provider);
      }
    }
    window.addEventListener(LITELLM_CONFIG_EVENT, handleConfigChange);
    return () => window.removeEventListener(LITELLM_CONFIG_EVENT, handleConfigChange);
  }, []);

  const loadDocuments = useCallback(async (): Promise<StoredDoc[]> => {
    setLoadingDocs(true);
    try {
      const res = await getJSON<any>("/api/intelligence/v1/documents?limit=50");
      const list: StoredDoc[] = Array.isArray(res) ? res : res?.items || [];
      setStoredDocs(list);
      if (list.length > 0) {
        setDocsCount(list.length);
      }
      return list;
    } catch (err) {
      console.warn("Could not load stored documents:", err);
      return [];
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Load chat history, tools, provider catalog, and saved model config on mount
  useEffect(() => {
    const local = loadLiteLLMConfig();
    setModelConfig(local);
    setActiveProviderTab(local.provider);

    async function loadData() {
      try {
        const histRes = await getJSON<{ ok: boolean; messages: ChatMessage[] }>(
          "/api/execution/v1/chat/history"
        );
        if (histRes?.messages && histRes.messages.length > 0) {
          setMessages(histRes.messages);
        }

        const toolsRes = await getJSON<{
          ok: boolean;
          connections: MarketplaceConnection[];
          overrides: Record<string, any>;
        }>("/api/execution/v1/chat/tools");
        if (toolsRes?.connections) setConnections(toolsRes.connections);
        if (toolsRes?.overrides) setOverrides(toolsRes.overrides);

        // Fetch remote provider catalog lazily
        try {
          const provRes = await getJSON<any>("/api/execution/v1/chat/providers");
          const list: any[] = Array.isArray(provRes)
            ? provRes
            : Array.isArray(provRes?.providers)
            ? provRes.providers
            : [];
          if (list.length > 0) {
            const merged: Record<string, LiteLLMProviderInfo> = { ...LITELLM_PROVIDERS };
            for (const item of list) {
              const pid = item.id || item.provider;
              if (!pid) continue;
              merged[pid] = {
                id: pid,
                name: item.name || merged[pid]?.name || pid,
                badge: merged[pid]?.badge || (item.env_api_key_set ? "Configured" : "Cloud"),
                defaultModel: item.default_model || merged[pid]?.defaultModel || `${pid}/default`,
                models:
                  Array.isArray(item.popular_models) && item.popular_models.length > 0
                    ? item.popular_models
                    : merged[pid]?.models || [item.default_model || `${pid}/default`],
                defaultBaseUrl: item.default_base_url ?? merged[pid]?.defaultBaseUrl ?? "",
                description: merged[pid]?.description || "",
                env_key_name: item.env_key_name || merged[pid]?.env_key_name,
                env_api_key_set: Boolean(item.env_api_key_set),
                requires_key: item.requires_key !== undefined ? Boolean(item.requires_key) : true,
              };
            }
            setProviderCatalog(merged);
          }
        } catch {
          // Static catalog fallback already active
        }

        // Fetch tenant active model config
        try {
          const cfgRes = await getJSON<{
            ok: boolean;
            provider?: string;
            model?: string;
            api_key?: string;
            base_url?: string;
          }>("/api/execution/v1/chat/model_config");
          if (cfgRes?.provider && cfgRes?.model) {
            const serverConfig: LiteLLMConfig = {
              provider: cfgRes.provider,
              model: cfgRes.model || local.model,
              apiKey: cfgRes.api_key || local.apiKey || "",
              baseUrl: cfgRes.base_url || local.baseUrl || "",
            };
            setModelConfig(serverConfig);
            setActiveProviderTab(serverConfig.provider);
            saveLiteLLMConfig(serverConfig);
          }
        } catch {
          // Local config remains active
        }
      } catch (err) {
        console.error("Failed to load initial chat data:", err);
      }
    }
    loadData();
  }, []);

  // Fetch dynamic models when the model picker opens for a provider
  useEffect(() => {
    if (!isModelMenuOpen || isEngineer) return;
    const pid = activeProviderTab;
    if (!pid || fetchedModelsByProvider[pid]) return;

    let cancelled = false;
    async function loadProviderModels() {
      setIsFetchingModels(true);
      try {
        const keyForProvider =
          pid === modelConfig.provider
            ? modelConfig.apiKey
            : loadSavedProviderKey(pid);
        const baseForProvider =
          pid === modelConfig.provider
            ? modelConfig.baseUrl
            : providerCatalog[pid]?.defaultBaseUrl;
        const res = await post<any>("/api/execution/v1/chat/models/fetch", {
          provider: pid,
          api_key: keyForProvider || undefined,
          base_url: baseForProvider || undefined,
        });
        const list: any[] = Array.isArray(res) ? res : res?.models || [];
        const ids = list
          .map((m: any) => (typeof m === "string" ? m : m?.id || m?.name))
          .filter(Boolean);
        if (!cancelled && ids.length > 0) {
          setFetchedModelsByProvider((prev) => ({ ...prev, [pid]: ids }));
        }
      } catch {
        // Catalog models remain available
      } finally {
        if (!cancelled) setIsFetchingModels(false);
      }
    }
    loadProviderModels();
    return () => {
      cancelled = true;
    };
  }, [
    isModelMenuOpen,
    isEngineer,
    activeProviderTab,
    fetchedModelsByProvider,
    modelConfig.provider,
    modelConfig.apiKey,
    modelConfig.baseUrl,
    providerCatalog,
  ]);

  async function handleSaveModelConfig(newConfig: LiteLLMConfig) {
    if (isEngineer) return;
    setModelConfig(newConfig);
    setActiveProviderTab(newConfig.provider);
    saveLiteLLMConfig(newConfig);
    try {
      await post("/api/execution/v1/chat/model_config", {
        provider: newConfig.provider,
        model: newConfig.model,
        api_key: newConfig.apiKey,
        base_url: newConfig.baseUrl,
      });
    } catch (err) {
      console.warn("Could not sync model config to backend:", err);
    }
  }

  function handleQuickSelectModel(targetProvider: string, chosenModel: string) {
    if (isEngineer) return;
    const isSameProvider = targetProvider === modelConfig.provider;
    const pInfo = providerCatalog[targetProvider] || LITELLM_PROVIDERS[targetProvider];
    const nextConfig: LiteLLMConfig = {
      provider: targetProvider,
      model: chosenModel,
      apiKey: isSameProvider ? modelConfig.apiKey : loadSavedProviderKey(targetProvider) || "",
      baseUrl: isSameProvider
        ? modelConfig.baseUrl || pInfo?.defaultBaseUrl || ""
        : pInfo?.defaultBaseUrl || "",
    };
    handleSaveModelConfig(nextConfig);
    setIsModelMenuOpen(false);
    setModelSearch("");
  }

  // Auto-scroll conversation feed
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 176)}px`;
    }
  }, [input]);

  function handleNewChat() {
    setMessages([]);
    setAttachedFiles([]);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function toggleAttachDocument(doc: StoredDoc) {
    setAttachedFiles((prev) => {
      const exists = prev.some((d) => d.id === doc.id);
      if (exists) return prev.filter((d) => d.id !== doc.id);
      return [...prev, doc];
    });
  }

  function removeAttachedFile(id: string) {
    setAttachedFiles((prev) => prev.filter((d) => d.id !== id));
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || uploadingFile || !canUpload) return;

    setUploadingFile(true);
    setUploadError(null);
    const fd = new FormData();
    fd.append("file", file);

    try {
      const r = await fetch(`${API.intelligence}/v1/documents`, {
        method: "POST",
        body: fd,
      });
      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j.detail || "File upload failed");
      }

      const updatedDocs = await loadDocuments();
      const uploadedId = j.document_id || j.id;
      const matched = updatedDocs.find((d) => d.id === uploadedId);
      const docToAttach: StoredDoc = matched || {
        id: uploadedId || `upload-${Date.now()}`,
        filename: file.name,
        status: j.status || "ready",
        created_at: new Date().toISOString(),
        doc_type: j.doc_type ?? null,
      };

      setAttachedFiles((prev) =>
        prev.some((d) => d.id === docToAttach.id) ? prev : [...prev, docToAttach]
      );
      setIsAddMenuOpen(false);
    } catch (err: any) {
      setUploadError(err?.message || "Upload failed");
    } finally {
      setUploadingFile(false);
    }
  }

  async function handleSend(promptText?: string) {
    const rawText = (promptText || input).trim();
    if (!rawText && attachedFiles.length === 0) return;
    if (loading) return;

    const effectiveText =
      rawText ||
      `Analyze attached workspace files: ${attachedFiles.map((f) => f.filename).join(", ")}`;

    const attachedContextStr =
      attachedFiles.length > 0
        ? `\n\n[Referencing Attached Documents: ${attachedFiles
            .map((f) => `${f.filename} (${f.doc_type || "Document"})`)
            .join(", ")}]`
        : "";

    const fullMessageText = effectiveText + attachedContextStr;
    const currentAttachments = [...attachedFiles];

    const userMsg: ChatMessage = {
      id: "u-" + Date.now(),
      role: "user",
      content: effectiveText,
      metadata: {
        attached_files: currentAttachments.map((f) => ({
          id: f.id,
          filename: f.filename,
          doc_type: f.doc_type,
        })),
      },
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setAttachedFiles([]);
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
    setIsAddMenuOpen(false);
    setIsModelMenuOpen(false);
    setLoading(true);

    try {
      const response = await post<{
        id: string;
        role: "assistant";
        content: string;
        tool_calls?: ToolCall[];
        dashboard_mutated?: boolean;
        overrides?: Record<string, any>;
        metadata?: Record<string, any>;
        timestamp?: string;
      }>("/api/execution/v1/chat/message", {
        message: fullMessageText,
        session_id: "default",
        history: messages.slice(-10),
        provider: modelConfig.provider,
        model: modelConfig.model,
        api_key: modelConfig.apiKey || undefined,
        base_url: modelConfig.baseUrl || undefined,
      });

      const assistantMsg: ChatMessage = {
        id: response.id || "a-" + Date.now(),
        role: "assistant",
        content: response.content,
        tool_calls:
          response.tool_calls ||
          (response.metadata?.tool_call ? [response.metadata.tool_call] : undefined),
        dashboard_mutated: response.dashboard_mutated || response.metadata?.dashboard_mutated,
        overrides: response.overrides || response.metadata?.overrides,
        metadata: response.metadata,
        timestamp: response.timestamp || new Date().toISOString(),
      };

      if (response.overrides) {
        setOverrides(response.overrides);
      }

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: "err-" + Date.now(),
          role: "assistant",
          content: `Failed to execute: ${
            err.message || "An unexpected error occurred while communicating with the agent service."
          }`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function toggleToolDetails(id: string) {
    setShowToolDetails((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // Build visible provider pills inside compact model popover
  const providerPills = useMemo(() => {
    const ids = [...QUICK_PROVIDER_IDS];
    if (modelConfig.provider && !ids.includes(modelConfig.provider)) {
      ids.unshift(modelConfig.provider);
    }
    return ids.filter((id) => providerCatalog[id] || LITELLM_PROVIDERS[id]);
  }, [modelConfig.provider, providerCatalog]);

  // Models displayed inside the compact model popover
  const modelOptions = useMemo(() => {
    const q = modelSearch.toLowerCase().trim();
    const out: Array<{ providerId: string; providerLabel: string; modelId: string }> = [];
    const seen = new Set<string>();

    const addForProvider = (pid: string) => {
      const info = providerCatalog[pid] || LITELLM_PROVIDERS[pid];
      const pLabel = formatProviderShortName(pid, info?.name);
      const dynamicList = fetchedModelsByProvider[pid] || [];
      const catalogList = info?.models || [];
      const combined = [...dynamicList, ...catalogList];
      if (info?.defaultModel) combined.push(info.defaultModel);
      if (pid === modelConfig.provider && modelConfig.model) {
        combined.unshift(modelConfig.model);
      }
      for (const m of combined) {
        if (!m) continue;
        const key = `${pid}::${m}`;
        if (seen.has(key)) continue;
        if (
          !q ||
          m.toLowerCase().includes(q) ||
          pid.toLowerCase().includes(q) ||
          pLabel.toLowerCase().includes(q)
        ) {
          seen.add(key);
          out.push({ providerId: pid, providerLabel: pLabel, modelId: m });
        }
      }
    };

    if (q) {
      addForProvider(activeProviderTab);
      for (const pid of Object.keys(providerCatalog)) {
        if (pid !== activeProviderTab) addForProvider(pid);
      }
    } else {
      addForProvider(activeProviderTab);
    }
    return out;
  }, [modelSearch, activeProviderTab, providerCatalog, fetchedModelsByProvider, modelConfig.provider, modelConfig.model]);

  const hasOverrides = overrides && Object.keys(overrides).length > 0;
  const isChatEmpty = messages.length === 0;
  const activeToolCount = connections.length || initialTools.length || 3;
  const activeProviderShort = formatProviderShortName(
    modelConfig.provider,
    providerCatalog[modelConfig.provider]?.name || LITELLM_PROVIDERS[modelConfig.provider]?.name
  );
  const activeModelShort = formatModelShortName(modelConfig.model);

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)] max-w-4xl mx-auto w-full">
      {/* Minimal Top Utility Row */}
      {(messages.length > 0 || hasOverrides) && (
        <div className="flex items-center justify-end gap-2 px-4 pt-1 pb-2 shrink-0">
          {hasOverrides && (
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 transition shadow-xs"
            >
              <IconBolt className="h-3 w-3 text-emerald-600" />
              <span>Dashboard Synced:</span>
              <span className="font-semibold text-neutral-900">
                {overrides.production_target || overrides.oee || "Active"}
              </span>
            </Link>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleNewChat}
              className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 transition shadow-xs"
            >
              New chat
            </button>
          )}
        </div>
      )}

      {/* Conversation Feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-3xl mx-auto w-full space-y-6">
          {isChatEmpty ? (
            <div className="pt-10 pb-4 space-y-8 animate-fadeIn">
              <div className="text-center space-y-3">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-950 text-white shadow-md">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
                  Cawrys Industrial Intelligence
                </h1>
                <p className="text-sm text-neutral-500 max-w-lg mx-auto leading-relaxed">
                  Autonomous plant orchestration, CAD engineering analysis, and live telemetry execution across{" "}
                  {docsCount} workspace file{docsCount === 1 ? "" : "s"} and {activeToolCount} active connectors.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
                {QUICK_ACTION_CARDS.map((card) => (
                  <button
                    key={card.title}
                    type="button"
                    onClick={() => handleSend(card.prompt)}
                    className="group rounded-2xl border border-neutral-200/80 bg-white p-4 text-left transition-all duration-200 hover:border-neutral-400 hover:shadow-md hover:bg-neutral-50 active:scale-[0.98]"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-sm font-semibold text-neutral-900 group-hover:text-black transition-colors">
                        {card.title}
                      </span>
                      <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[10px] font-medium text-neutral-600 border border-neutral-200">
                        {card.tag}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500 leading-relaxed group-hover:text-neutral-700">
                      {card.subtitle}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => {
              const isUser = m.role === "user";
              const toolCall = m.tool_calls && m.tool_calls.length > 0 ? m.tool_calls[0] : null;
              const userAttached = m.metadata?.attached_files as
                | Array<{ id: string; filename: string }>
                | undefined;
              const timeStr = formatTime(m.timestamp || m.created_at);

              return (
                <div
                  key={m.id}
                  className={`flex gap-3.5 ${isUser ? "justify-end" : "justify-start"}`}
                >
                  {!isUser && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-white shadow-sm mt-0.5">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] rounded-2xl p-5 text-sm leading-relaxed ${
                      isUser
                        ? "bg-neutral-950 text-white rounded-tr-none shadow-sm"
                        : "bg-white rounded-2xl p-5 border border-neutral-200/60 shadow-sm text-neutral-900 rounded-tl-none"
                    }`}
                  >
                    {isUser && userAttached && userAttached.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5 pb-2 border-b border-neutral-700">
                        {userAttached.map((f) => (
                          <span
                            key={f.id}
                            className="inline-flex items-center gap-1 rounded-md bg-neutral-800 px-2 py-0.5 text-[11px] font-mono text-neutral-200"
                          >
                            <IconFile className="h-3 w-3" />
                            <span>{f.filename}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {isUser && <p className="whitespace-pre-wrap">{m.content}</p>}

                    {!isUser && (
                      <div className="space-y-3">
                        <div className="prose prose-sm max-w-none whitespace-pre-wrap leading-relaxed text-neutral-900">
                          {m.content}
                        </div>

                        {m.dashboard_mutated && (
                          <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white">
                                  <IconCheck className="h-3 w-3 stroke-[3]" />
                                </span>
                                <span className="font-semibold text-emerald-950">
                                  Live Dashboard Overrides Applied
                                </span>
                              </div>
                              <Link
                                href="/"
                                className="inline-flex items-center gap-1 rounded-full bg-emerald-100 hover:bg-emerald-200 px-3 py-1 font-semibold text-emerald-900 transition"
                              >
                                Open Dashboard &rarr;
                              </Link>
                            </div>
                            {m.overrides && (
                              <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-emerald-200 pt-2 text-[11px] text-emerald-800">
                                {m.overrides.production_target && (
                                  <div>
                                    <span className="text-emerald-700">Target: </span>
                                    <b>{m.overrides.production_target}</b>
                                  </div>
                                )}
                                {m.overrides.risk_level && (
                                  <div>
                                    <span className="text-emerald-700">Risk Level: </span>
                                    <b>{m.overrides.risk_level}</b>
                                  </div>
                                )}
                                {m.overrides.oee && (
                                  <div>
                                    <span className="text-emerald-700">OEE: </span>
                                    <b>{m.overrides.oee}</b>
                                  </div>
                                )}
                                {m.overrides.operational_status && (
                                  <div>
                                    <span className="text-emerald-700">Status: </span>
                                    <b>{m.overrides.operational_status}</b>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {toolCall && (
                          <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 text-xs text-neutral-900">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-[11px] text-neutral-800 font-bold">
                                  {toolCall.connector.toUpperCase()}
                                </span>
                                <span className="font-semibold text-neutral-900">
                                  {toolCall.app} &middot; {toolCall.tool}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleToolDetails(m.id)}
                                className="text-[11px] text-neutral-600 hover:text-neutral-900 underline font-medium"
                              >
                                {showToolDetails[m.id] ? "Hide payload" : "Inspect payload"}
                              </button>
                            </div>

                            {showToolDetails[m.id] && (
                              <pre className="mt-2 overflow-x-auto rounded-xl bg-neutral-900 p-2.5 font-mono text-[11px] text-neutral-200">
                                {JSON.stringify(
                                  {
                                    params: toolCall.params,
                                    returned_data: toolCall.data,
                                  },
                                  null,
                                  2
                                )}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {isUser ? (
                      timeStr ? (
                        <div className="mt-1.5 text-[10px] text-neutral-400 text-right">{timeStr}</div>
                      ) : null
                    ) : (
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-1.5 text-[10px] text-neutral-500">
                        <div className="flex flex-wrap items-center gap-1.5 font-mono">
                          <span className="flex items-center gap-1 text-neutral-800 font-medium">
                            <span className="h-1.5 w-1.5 rounded-full bg-neutral-950" />
                            via {formatModelShortName(m.metadata?.model || modelConfig.model)}
                          </span>
                          {m.metadata?.live_ai ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700 border border-emerald-200">
                              Live AI
                            </span>
                          ) : (
                            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[9px] text-neutral-600 border border-neutral-200">
                              Context Engine
                            </span>
                          )}
                          {m.metadata?.latency_ms !== undefined && (
                            <>
                              <span className="text-neutral-400">&middot;</span>
                              <span>{m.metadata.latency_ms}ms</span>
                            </>
                          )}
                          {m.metadata?.provider && (
                            <>
                              <span className="text-neutral-400">&middot;</span>
                              <span className="capitalize">{m.metadata.provider}</span>
                            </>
                          )}
                        </div>
                        {timeStr && <span>{timeStr}</span>}
                      </div>
                    )}
                  </div>

                  {isUser && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-neutral-900 font-bold text-xs uppercase shadow-sm mt-0.5">
                      {role[0]}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {loading && (
            <div className="flex gap-3 justify-start items-center">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-white shadow-sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 animate-spin">
                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="10" />
                </svg>
              </div>
              <div className="rounded-2xl rounded-tl-none border border-neutral-200/80 bg-white p-3 text-xs text-neutral-700 flex items-center gap-2 shadow-sm">
                <span className="h-2 w-2 rounded-full bg-neutral-950 animate-ping" />
                Synthesizing agent response &amp; evaluating operational tools...
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating Bottom Input Composer */}
      <div className="relative z-20 pt-2 pb-4 px-4 max-w-3xl mx-auto w-full shrink-0">
        <div className="rounded-3xl border border-neutral-200/90 bg-white shadow-md px-4 py-3 transition-all focus-within:border-neutral-300 focus-within:shadow-lg">
          {/* Top Attachment Preview Chips */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pb-2.5 mb-2.5 border-b border-neutral-100">
              {attachedFiles.map((f) => (
                <div
                  key={f.id}
                  className="group relative flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50/80 px-2.5 py-1.5 text-xs text-neutral-800"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600">
                    <IconFile className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="max-w-[160px] truncate font-medium text-neutral-900 leading-tight">
                      {f.filename}
                    </div>
                    {f.doc_type && (
                      <div className="text-[10px] uppercase text-neutral-400 leading-tight">
                        {f.doc_type}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachedFile(f.id)}
                    aria-label={`Remove ${f.filename}`}
                    title="Remove attachment"
                    className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-200 hover:text-neutral-900 transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-2.5 w-2.5">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Borderless Prompt Textarea */}
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything, attach workspace files, or run operational commands..."
            className="w-full resize-none bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none leading-relaxed max-h-44"
          />

          {/* Bottom Bar Below Input Area */}
          <div className="flex items-center justify-between gap-2 pt-2">
            {/* Left Side: + Button & Small Model Capsule */}
            <div className="flex items-center gap-1.5 relative min-w-0">
              {/* + Add / Attach Button & Popover */}
              <div ref={addMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsModelMenuOpen(false);
                    setIsAddMenuOpen((v) => !v);
                  }}
                  aria-label="Add files"
                  title="Upload or attach workspace files"
                  className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
                    isAddMenuOpen
                      ? "bg-neutral-100 text-neutral-900"
                      : "text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100"
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleUploadFile}
                />

                {isAddMenuOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-neutral-200 bg-white p-2 shadow-xl z-40">
                    {canUpload && (
                      <div className="pb-1.5 mb-1.5 border-b border-neutral-100">
                        <button
                          type="button"
                          disabled={uploadingFile}
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium text-neutral-900 hover:bg-neutral-100 transition-colors disabled:opacity-50"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-neutral-600 shrink-0">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                          </svg>
                          <span>{uploadingFile ? "Uploading document..." : "Upload file from computer"}</span>
                        </button>
                        {uploadError && (
                          <p className="px-2.5 pt-1 text-[11px] text-rose-600">{uploadError}</p>
                        )}
                      </div>
                    )}

                    <div className="px-2.5 py-1 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                        Workspace Files
                      </span>
                      <span className="text-[10px] font-mono text-neutral-400">
                        {storedDocs.length}
                      </span>
                    </div>

                    <div className="max-h-52 overflow-y-auto space-y-0.5 pr-0.5">
                      {loadingDocs ? (
                        <div className="px-2.5 py-3 text-xs text-neutral-400 text-center">
                          Loading files...
                        </div>
                      ) : storedDocs.length === 0 ? (
                        <div className="px-2.5 py-3 text-xs text-neutral-400 text-center">
                          No workspace files available
                        </div>
                      ) : (
                        storedDocs.map((doc) => {
                          const isAttached = attachedFiles.some((f) => f.id === doc.id);
                          return (
                            <button
                              key={doc.id}
                              type="button"
                              onClick={() => toggleAttachDocument(doc)}
                              className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors ${
                                isAttached
                                  ? "bg-neutral-950 text-white"
                                  : "text-neutral-800 hover:bg-neutral-100"
                              }`}
                              title={doc.filename}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <IconFile
                                  className={`h-3.5 w-3.5 shrink-0 ${
                                    isAttached ? "text-white" : "text-neutral-400"
                                  }`}
                                />
                                <span className="truncate font-medium">{doc.filename}</span>
                              </div>
                              {isAttached && (
                                <IconCheck className="h-3.5 w-3.5 text-white shrink-0" />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Small Model Capsule */}
              <div ref={modelMenuRef} className="relative min-w-0">
                {isEngineer ? (
                  <div
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-neutral-600 select-none cursor-default max-w-full"
                    title="Configured by Administrator. Contact system admin to change model."
                  >
                    <span className="truncate max-w-[230px]">
                      {activeModelShort} ({activeProviderShort})
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      setIsModelMenuOpen((v) => !v);
                    }}
                    title="Select AI model"
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors select-none max-w-full ${
                      isModelMenuOpen
                        ? "bg-neutral-100 text-neutral-900"
                        : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
                    }`}
                  >
                    <span className="truncate max-w-[230px]">
                      {activeModelShort} ({activeProviderShort})
                    </span>
                    <IconChevronDown
                      className={`h-3.5 w-3.5 text-neutral-400 shrink-0 transition-transform ${
                        isModelMenuOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                )}

                {/* Compact Model Picker Popover */}
                {!isEngineer && isModelMenuOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-neutral-200 bg-white p-2 shadow-xl z-40 space-y-2">
                    <div className="relative">
                      <IconSearch className="absolute left-2.5 top-2 h-3.5 w-3.5 text-neutral-400" />
                      <input
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder="Search models..."
                        autoFocus
                        className="w-full rounded-xl border border-neutral-200 bg-neutral-50 pl-8 pr-2.5 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
                      />
                    </div>

                    {!modelSearch.trim() && (
                      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
                        {providerPills.map((pid) => {
                          const pInfo = providerCatalog[pid] || LITELLM_PROVIDERS[pid];
                          const active = activeProviderTab === pid;
                          return (
                            <button
                              key={pid}
                              type="button"
                              onClick={() => setActiveProviderTab(pid)}
                              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                active
                                  ? "bg-neutral-950 text-white"
                                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900"
                              }`}
                            >
                              {formatProviderShortName(pid, pInfo?.name)}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="max-h-52 overflow-y-auto space-y-0.5 pr-0.5">
                      {isFetchingModels && modelOptions.length === 0 ? (
                        <div className="px-2.5 py-3 text-xs text-neutral-400 text-center">
                          Loading models...
                        </div>
                      ) : modelOptions.length === 0 ? (
                        <div className="px-2.5 py-3 text-xs text-neutral-400 text-center">
                          No matching models found
                        </div>
                      ) : (
                        modelOptions.map((item) => {
                          const isCurrent =
                            item.providerId === modelConfig.provider &&
                            item.modelId === modelConfig.model;
                          return (
                            <button
                              key={`${item.providerId}:${item.modelId}`}
                              type="button"
                              onClick={() => handleQuickSelectModel(item.providerId, item.modelId)}
                              className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors ${
                                isCurrent
                                  ? "bg-neutral-950 text-white"
                                  : "text-neutral-800 hover:bg-neutral-100"
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-mono text-[11px] font-medium">
                                  {formatModelShortName(item.modelId)}
                                </div>
                                {modelSearch.trim() && (
                                  <div
                                    className={`text-[10px] ${
                                      isCurrent ? "text-neutral-300" : "text-neutral-400"
                                    }`}
                                  >
                                    {item.providerLabel}
                                  </div>
                                )}
                              </div>
                              {isCurrent && (
                                <IconCheck className="h-3.5 w-3.5 text-white shrink-0" />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>

                    <div className="border-t border-neutral-100 pt-1.5">
                      <Link
                        href="/settings"
                        className="block rounded-xl px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
                      >
                        API keys &amp; advanced setup in Settings &rarr;
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Side: Auto Status & Send Button */}
            <div className="flex items-center gap-2 shrink-0">
              <div
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-neutral-500 select-none"
                title={`Autonomous routing across ${activeToolCount} active connectors`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5 text-neutral-400" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span>Auto</span>
              </div>

              <button
                type="button"
                onClick={() => handleSend()}
                disabled={(!input.trim() && attachedFiles.length === 0) || loading}
                className="h-8 w-8 rounded-full bg-neutral-950 hover:bg-neutral-800 text-white flex items-center justify-center shadow-sm active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                aria-label="Send message"
              >
                {loading ? (
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="12" cy="12" r="10" strokeWidth="3" strokeDasharray="30" strokeDashoffset="10" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-4 w-4">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
