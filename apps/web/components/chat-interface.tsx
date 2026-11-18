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
import { MarkdownPreview } from "./markdown-preview";

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

type ChatSessionSummary = {
  session_id: string;
  title: string;
  project?: string;
  updated_at: string;
  message_count: number;
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

function formatRelativeShort(ts?: string): string {
  if (!ts) return "now";
  const normalized = ts.includes("T") || ts.endsWith("Z") ? ts : ts.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "now";
  const diffSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diffSec < 60) return "now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

export function formatProviderShortName(providerId: string, fullName?: string): string {
  if (PROVIDER_SHORT_NAMES[providerId]) return PROVIDER_SHORT_NAMES[providerId];
  return fullName || providerId;
}

export function formatModelShortName(modelId: string): string {
  if (!modelId) return "default";
  const parts = modelId.split("/");
  return parts[parts.length - 1] || modelId;
}

function cleanUserMessageContent(text: string): string {
  return (text || "").replace(/\n*\[Referencing Attached Documents:[^\]]*\]/g, "").trim();
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
  const [sessionId, setSessionId] = useState<string>("default");
  const [connections, setConnections] = useState<MarketplaceConnection[]>(initialConnections);
  const [overrides, setOverrides] = useState<Record<string, any>>(initialOverrides);
  const [docsCount, setDocsCount] = useState<number>(initialDocsCount);
  const [modelConfig, setModelConfig] = useState<LiteLLMConfig>(DEFAULT_LITELLM_CONFIG);
  const [showToolDetails, setShowToolDetails] = useState<Record<string, boolean>>({});

  // Attached file chips
  const [attachedFiles, setAttachedFiles] = useState<StoredDoc[]>([]);

  // Conversation history sidebar
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessionFilter, setSessionFilter] = useState("");
  const [showFilterInput, setShowFilterInput] = useState(false);

  // Composer "+" add/upload popover state
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [persistenceMode, setPersistenceMode] = useState<"local" | "neon">("local");
  const [persistenceLoading, setPersistenceLoading] = useState(false);

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
  // and collapse sidebar by default on narrow viewports so mobile chat stays unobstructed
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      }
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
    try {
      const res = await getJSON<any>("/api/intelligence/v1/documents?limit=50");
      const list: StoredDoc[] = Array.isArray(res) ? res : res?.items || [];
      if (list.length > 0) {
        setDocsCount(list.length);
      }
      return list;
    } catch (err) {
      console.warn("Could not load stored documents:", err);
      return [];
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await getJSON<{ ok: boolean; sessions: ChatSessionSummary[] }>(
        "/api/execution/v1/chat/sessions"
      );
      if (Array.isArray(res?.sessions)) {
        setSessions(res.sessions);
      }
    } catch (err) {
      console.warn("Could not load chat sessions:", err);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
    loadSessions();
  }, [loadDocuments, loadSessions]);

  useEffect(() => {
    let isMounted = true;
    fetch("/api/intelligence/v1/system/persistence-mode")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted && data?.mode) {
          setPersistenceMode(data.mode === "neon" ? "neon" : "local");
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  async function togglePersistence() {
    if (persistenceLoading) return;
    const nextMode = persistenceMode === "local" ? "neon" : "local";
    setPersistenceLoading(true);
    try {
      const res = await fetch("/api/intelligence/v1/system/persistence-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode }),
      });
      if (res.ok) {
        const data = await res.json();
        setPersistenceMode(data.mode === "neon" ? "neon" : "local");
        await Promise.all([loadDocuments(), loadSessions()]);
      }
    } catch (err) {
      console.warn("Failed to toggle persistence mode:", err);
    } finally {
      setPersistenceLoading(false);
    }
  }

  // Load chat history, tools, provider catalog, and saved model config on mount
  useEffect(() => {
    const local = loadLiteLLMConfig();
    setModelConfig(local);
    setActiveProviderTab(local.provider);

    async function loadData() {
      try {
        let activeSession = "default";
        if (typeof window !== "undefined") {
          activeSession = localStorage.getItem("liontix_chat_session_id") || "";
          if (!activeSession) {
            activeSession = "session_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
            localStorage.setItem("liontix_chat_session_id", activeSession);
          }
          setSessionId(activeSession);
        }

        const histRes = await getJSON<{ ok: boolean; messages: ChatMessage[] }>(
          `/api/execution/v1/chat/history?session_id=${encodeURIComponent(activeSession)}`
        );
        if (histRes?.messages && histRes.messages.length > 0) {
          setMessages(histRes.messages);
        } else {
          setMessages([]);
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

  async function handleNewChat() {
    const newSid = "session_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    if (typeof window !== "undefined") {
      localStorage.setItem("liontix_chat_session_id", newSid);
    }
    setSessionId(newSid);
    setMessages([]);
    setAttachedFiles([]);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function handleSelectSession(sess: ChatSessionSummary) {
    if (!sess.session_id || loading) return;
    setSessionId(sess.session_id);
    if (typeof window !== "undefined") {
      localStorage.setItem("liontix_chat_session_id", sess.session_id);
    }
    setAttachedFiles([]);
    try {
      const histRes = await getJSON<{ ok: boolean; messages: ChatMessage[] }>(
        `/api/execution/v1/chat/history?session_id=${encodeURIComponent(sess.session_id)}`
      );
      setMessages(Array.isArray(histRes?.messages) ? histRes.messages : []);
    } catch (err) {
      console.warn("Could not load selected chat history:", err);
    }
  }

  async function handleDeleteSession(sid: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await fetch(`/api/execution/v1/chat/history?session_id=${encodeURIComponent(sid)}`, {
        method: "DELETE",
      });
      if (sid === sessionId) {
        await handleNewChat();
      }
      await loadSessions();
    } catch (err) {
      console.warn("Could not delete chat session:", err);
    }
  }

  function scrollToMessage(msgId: string) {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function removeAttachedFile(id: string) {
    setAttachedFiles((prev) => prev.filter((d) => d.id !== id));
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0 || uploadingFile || !canUpload) return;

    setUploadingFile(true);
    setUploadError(null);
    const uploadedResults: Array<{ file: File; payload: any }> = [];

    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
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
        uploadedResults.push({ file, payload: j });
      }

      const updatedDocs = await loadDocuments();
      const newlyAttached: StoredDoc[] = [];
      for (const item of uploadedResults) {
        const uploadedId = item.payload.document_id || item.payload.id;
        const matched = updatedDocs.find((d) => d.id === uploadedId);
        newlyAttached.push(
          matched || {
            id: uploadedId || `upload-${Date.now()}`,
            filename: item.file.name,
            status: item.payload.status || "ready",
            created_at: new Date().toISOString(),
            doc_type: item.payload.doc_type ?? null,
          }
        );
      }

      setAttachedFiles((prev) => {
        const merged = [...prev];
        for (const doc of newlyAttached) {
          if (!merged.some((d) => d.id === doc.id)) {
            merged.push(doc);
          }
        }
        return merged;
      });
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
        message: effectiveText,
        session_id: sessionId || "default",
        attached_document_ids: currentAttachments.map((f) => f.id).filter(Boolean),
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
      loadSessions();
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
  const activeModelShort = formatModelShortName(modelConfig.model);

  const filteredSessions = useMemo(() => {
    const q = sessionFilter.trim().toLowerCase();
    const list = [...sessions];
    const hasCurrentInList = list.some((s) => s.session_id === sessionId);
    if (!hasCurrentInList && messages.length > 0 && sessionId) {
      const firstUser = messages.find((m) => m.role === "user");
      const rawTitle = cleanUserMessageContent(firstUser?.content || "") || "New Conversation";
      const title = rawTitle.length > 44 ? rawTitle.slice(0, 41).trimEnd() + "..." : rawTitle;
      list.unshift({
        session_id: sessionId,
        title,
        updated_at: firstUser?.timestamp || new Date().toISOString(),
        message_count: messages.length,
      });
    }
    if (!q) return list;
    return list.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, sessionId, messages, sessionFilter]);

  const activeSessionTitle = useMemo(() => {
    const found = sessions.find((s) => s.session_id === sessionId);
    if (found?.title) return found.title;
    const firstUser = messages.find((m) => m.role === "user");
    if (firstUser) {
      const cleaned = cleanUserMessageContent(firstUser.content);
      return cleaned.length > 44 ? cleaned.slice(0, 41).trimEnd() + "..." : cleaned || "New Conversation";
    }
    return "New Conversation";
  }, [sessions, sessionId, messages]);

  return (
    <div className="relative flex h-full w-full gap-2 sm:gap-3 md:gap-4 p-2 sm:p-3.5 md:p-4 lg:p-5 overflow-hidden bg-[var(--surface-canvas)]">
      {/* Mobile Sidebar Scrim */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-neutral-950/35 backdrop-blur-[2px] md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Conversation History Sidebar */}
      {sidebarOpen && (
        <aside className="fixed inset-y-2 left-2 z-40 flex w-64 shrink-0 flex-col rounded-2xl bg-neutral-950 text-neutral-200 border border-neutral-800 p-3 shadow-[0_20px_50px_rgba(15,23,42,0.28)] md:static md:z-auto md:shadow-none select-none overflow-hidden">
          {/* Top Action: + New Conversation */}
          <button
            type="button"
            onClick={() => {
              handleNewChat();
              if (typeof window !== "undefined" && window.innerWidth < 768) {
                setSidebarOpen(false);
              }
            }}
            className="h-9 w-full rounded-xl border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-700 px-3 text-xs font-medium text-white flex items-center gap-2 transition-[background-color,border-color,transform] duration-150 ease-out-quart active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 shrink-0"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-neutral-300 shrink-0" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>New Conversation</span>
          </button>

          {/* Conversations Section Header */}
          <div className="mt-4 mb-2 flex items-center justify-between px-1.5 shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-neutral-400">
              Conversations
            </span>
            <button
              type="button"
              onClick={() => setShowFilterInput((v) => !v)}
              title="Filter conversations"
              aria-label="Filter conversations"
              aria-pressed={showFilterInput}
              className={`h-6 w-6 flex items-center justify-center rounded-lg transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                showFilterInput || sessionFilter
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-3.5 w-3.5" aria-hidden="true">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="7" y1="12" x2="17" y2="12" />
                <line x1="10" y1="18" x2="14" y2="18" />
              </svg>
            </button>
          </div>

          {showFilterInput && (
            <div className="mb-2 px-0.5 shrink-0">
              <input
                type="text"
                value={sessionFilter}
                onChange={(e) => setSessionFilter(e.target.value)}
                placeholder="Filter conversations..."
                aria-label="Filter conversations by title"
                className="h-8 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-2.5 text-xs text-neutral-100 placeholder:text-neutral-400 focus:border-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              />
            </div>
          )}

          {/* Flat Conversations List */}
          <div className="flex-1 overflow-y-auto no-scrollbar space-y-0.5">
            {filteredSessions.length === 0 ? (
              <div className="px-2.5 py-6 text-center text-xs text-neutral-400">
                {sessionFilter.trim() ? "No matching conversations" : "No conversations yet"}
              </div>
            ) : (
              filteredSessions.map((sess) => {
                const isActiveSession = sess.session_id === sessionId;
                return (
                  <div
                    key={sess.session_id}
                    onClick={() => {
                      handleSelectSession(sess);
                      if (typeof window !== "undefined" && window.innerWidth < 768) {
                        setSidebarOpen(false);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSelectSession(sess);
                        if (typeof window !== "undefined" && window.innerWidth < 768) {
                          setSidebarOpen(false);
                        }
                      }
                    }}
                    className={`group flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs cursor-pointer transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                      isActiveSession
                        ? "bg-neutral-800 border border-neutral-700 text-white font-medium"
                        : "border border-transparent text-neutral-300 hover:bg-neutral-900 hover:text-white"
                    }`}
                    title={sess.title}
                  >
                    <span className="truncate min-w-0 flex-1">{sess.title}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[11px] text-neutral-400 tabular-nums">
                        {formatRelativeShort(sess.updated_at)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(sess.session_id, e)}
                        title="Delete conversation"
                        aria-label={`Delete ${sess.title}`}
                        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 flex h-5 w-5 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-700 hover:text-white transition-all duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-2.5 w-2.5" aria-hidden="true">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}

      {/* Main Chat Canvas Card */}
      <div className="flex-1 min-w-0 flex flex-col rounded-2xl border border-neutral-200 bg-white relative overflow-hidden">
        {/* Compact Header Bar */}
        <div className="flex items-center justify-between gap-2 border-b border-neutral-200/70 px-3.5 sm:px-4 pr-32 sm:pr-36 h-12 shrink-0 bg-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              title={sidebarOpen ? "Hide conversation sidebar" : "Show conversation sidebar"}
              aria-label="Toggle conversation sidebar"
              aria-expanded={sidebarOpen}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 active:scale-[0.98] transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1 shrink-0"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4 w-4" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
            <div className="flex items-center gap-1.5 text-xs text-neutral-600 min-w-0">
              <span className="truncate font-semibold tracking-tight text-neutral-950">{activeSessionTitle}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasOverrides && (
              <Link
                href="/"
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100 transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1"
              >
                <IconBolt className="h-3 w-3 text-emerald-700" />
                <span>Synced:</span>
                <span className="font-semibold text-emerald-950">
                  {overrides.production_target || overrides.oee || "Active"}
                </span>
              </Link>
            )}
            <button
              type="button"
              onClick={() => handleNewChat()}
              className="md:hidden inline-flex h-7 items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50 hover:border-neutral-300 active:scale-[0.98] transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
            >
              New
            </button>
          </div>
        </div>

        {/* Conversation Feed */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar px-4 sm:px-6 py-6">
          <div className={`max-w-3xl mx-auto w-full ${isChatEmpty ? "min-h-[60vh] flex flex-col items-center justify-center" : "space-y-6"}`}>
          {isChatEmpty ? (
            <div className="py-8 animate-fadeIn">
              <div className="text-center space-y-3.5 max-w-lg mx-auto">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-950 text-white">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
                <h1 className="text-2xl sm:text-[1.75rem] leading-[1.18] font-semibold tracking-[-0.025em] text-neutral-950">
                  Cawrys Industrial Intelligence
                </h1>
                <p className="text-sm text-neutral-600 max-w-md mx-auto leading-relaxed tabular-nums">
                  Autonomous plant orchestration, CAD engineering analysis, and live telemetry execution across{" "}
                  {docsCount} workspace file{docsCount === 1 ? "" : "s"} and {activeToolCount} active connectors.
                </p>
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
                  id={`msg-${m.id}`}
                  className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
                >
                  {!isUser && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-white mt-0.5">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] rounded-2xl text-sm leading-relaxed ${
                      isUser
                        ? "bg-neutral-950 text-white rounded-tr-sm px-4 py-3.5"
                        : "bg-[var(--surface-elevated)] border border-neutral-200 text-neutral-950 rounded-tl-sm px-5 py-4"
                    }`}
                  >
                    {isUser && userAttached && userAttached.length > 0 && (
                      <div className="mb-2.5 flex flex-wrap gap-1.5 pb-2 border-b border-neutral-800">
                        {userAttached.map((f) => (
                          <span
                            key={f.id}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 border border-neutral-800 px-2 py-0.5 text-[11px] font-mono text-neutral-200"
                          >
                            <IconFile className="h-3 w-3 text-neutral-300" />
                            <span>{f.filename}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {isUser && <p className="whitespace-pre-wrap">{cleanUserMessageContent(m.content)}</p>}

                    {!isUser && (
                      <div className="space-y-3">
                        <div className="max-w-none leading-relaxed text-neutral-900">
                          <MarkdownPreview content={m.content} />
                        </div>

                        {m.metadata?.playbook_mutated && (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-xs text-neutral-800">
                            <span className="font-semibold text-neutral-950">
                              Playbook Pipeline Updated
                            </span>
                            <Link
                              href="/playbooks"
                              className="inline-flex h-7 items-center gap-1 rounded-full bg-neutral-950 px-3 text-[11px] font-medium text-white hover:bg-neutral-800 active:scale-[0.98] transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1"
                            >
                              Open Canvas &rarr;
                            </Link>
                          </div>
                        )}

                        {m.dashboard_mutated && (
                          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-950">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white shrink-0">
                                  <IconCheck className="h-3 w-3 stroke-[3]" />
                                </span>
                                <span className="font-semibold text-emerald-950">
                                  Live Dashboard Overrides Applied
                                </span>
                              </div>
                              <Link
                                href="/"
                                className="inline-flex h-7 items-center gap-1 rounded-full border border-emerald-200 bg-white px-3 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1"
                              >
                                Open Dashboard &rarr;
                              </Link>
                            </div>
                            {m.overrides && (
                              <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-emerald-200/80 pt-2.5 text-[11px] text-emerald-900 tabular-nums">
                                {m.overrides.production_target && (
                                  <div>
                                    <span className="text-emerald-800">Target: </span>
                                    <strong className="font-semibold text-emerald-950">{m.overrides.production_target}</strong>
                                  </div>
                                )}
                                {m.overrides.risk_level && (
                                  <div>
                                    <span className="text-emerald-800">Risk Level: </span>
                                    <strong className="font-semibold text-emerald-950">{m.overrides.risk_level}</strong>
                                  </div>
                                )}
                                {m.overrides.oee && (
                                  <div>
                                    <span className="text-emerald-800">OEE: </span>
                                    <strong className="font-semibold text-emerald-950">{m.overrides.oee}</strong>
                                  </div>
                                )}
                                {m.overrides.operational_status && (
                                  <div>
                                    <span className="text-emerald-800">Status: </span>
                                    <strong className="font-semibold text-emerald-950">{m.overrides.operational_status}</strong>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {toolCall && (
                          <div className="mt-3 overflow-hidden rounded-xl border border-neutral-200 bg-white text-xs text-neutral-900">
                            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-neutral-50/70">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-neutral-700 shrink-0">
                                  {toolCall.connector}
                                </span>
                                <span className="font-semibold text-neutral-950 truncate">
                                  {toolCall.app}
                                </span>
                                <span className="text-neutral-400" aria-hidden="true">/</span>
                                <span className="font-mono text-[11px] text-neutral-600 truncate">
                                  {toolCall.tool}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleToolDetails(m.id)}
                                aria-expanded={Boolean(showToolDetails[m.id])}
                                className="inline-flex h-7 items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 active:scale-[0.98] transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 shrink-0"
                              >
                                <span>{showToolDetails[m.id] ? "Hide payload" : "Inspect payload"}</span>
                                <IconChevronDown
                                  className={`h-3 w-3 text-neutral-500 transition-transform duration-150 ease-out-quart ${
                                    showToolDetails[m.id] ? "rotate-180" : ""
                                  }`}
                                />
                              </button>
                            </div>

                            {showToolDetails[m.id] && (
                              <pre className="border-t border-neutral-200 overflow-x-auto no-scrollbar bg-neutral-950 p-3.5 font-mono text-[11px] leading-relaxed text-neutral-200">
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
                        <div className="mt-1.5 text-[11px] text-neutral-300 text-right tabular-nums">{timeStr}</div>
                      ) : null
                    ) : (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200/70 pt-2 text-[11px] text-neutral-600">
                        <div className="flex flex-wrap items-center gap-1.5 font-mono">
                          <span className="flex items-center gap-1.5 text-neutral-900 font-medium">
                            <span className="h-1.5 w-1.5 rounded-full bg-neutral-950 shrink-0" />
                            <span>via {formatModelShortName(m.metadata?.model || modelConfig.model)}</span>
                          </span>
                          {m.metadata?.live_ai ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 border border-emerald-200 font-sans">
                              Live AI
                            </span>
                          ) : (
                            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-700 border border-neutral-200 font-sans">
                              Context Engine
                            </span>
                          )}
                          {m.metadata?.latency_ms !== undefined && (
                            <>
                              <span className="text-neutral-400" aria-hidden="true">&middot;</span>
                              <span className="tabular-nums text-neutral-600">{m.metadata.latency_ms}ms</span>
                            </>
                          )}
                          {m.metadata?.provider && (
                            <>
                              <span className="text-neutral-400" aria-hidden="true">&middot;</span>
                              <span className="capitalize text-neutral-600">{m.metadata.provider}</span>
                            </>
                          )}
                        </div>
                        {timeStr && <span className="tabular-nums text-neutral-600">{timeStr}</span>}
                      </div>
                    )}
                  </div>

                  {isUser && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 border border-neutral-300/60 text-neutral-900 font-semibold text-xs uppercase mt-0.5">
                      {role[0]}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {loading && (
            <div className="flex gap-3 justify-start items-center">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-white">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 animate-spin" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="10" />
                </svg>
              </div>
              <div className="rounded-2xl rounded-tl-sm border border-neutral-200 bg-[var(--surface-elevated)] px-4 py-3 text-xs font-medium text-neutral-700 flex items-center gap-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-600 shrink-0" />
                <span>Synthesizing agent response &amp; evaluating operational tools...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right-Edge Vertical Turn Scrubber */}
      {messages.length > 0 && (
        <div
          className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 z-20 flex-col items-center gap-1.5 py-2 px-1"
          aria-label="Conversation turns"
        >
          {messages.map((m, idx) => {
            const isLast = idx === messages.length - 1;
            const preview = cleanUserMessageContent(m.content).slice(0, 48);
            return (
              <button
                key={`nav-${m.id}`}
                type="button"
                onClick={() => scrollToMessage(m.id)}
                title={`${m.role === "user" ? "You" : "Assistant"}: ${preview}`}
                aria-label={`Jump to message ${idx + 1}`}
                className="group p-0.5 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              >
                {isLast ? (
                  <span className="block h-2 w-2 rounded-full bg-neutral-950 group-hover:scale-125 transition-transform duration-150 ease-out-quart" />
                ) : (
                  <span
                    className={`block h-[3px] rounded-full transition-all duration-150 ease-out-quart group-hover:w-3.5 group-hover:bg-neutral-800 ${
                      m.role === "user" ? "w-2 bg-neutral-400" : "w-2.5 bg-neutral-300"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Floating Bottom Input Composer */}
      <div className="relative z-20 pt-2 pb-4 px-4 sm:px-6 max-w-3xl mx-auto w-full shrink-0">
        <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 transition-colors duration-150 ease-out-quart focus-within:border-neutral-400">
          {/* Top Attachment Preview Chips */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pb-2.5 mb-2.5 border-b border-neutral-200/70">
              {attachedFiles.map((f) => (
                <div
                  key={f.id}
                  className="group relative flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-900"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-700">
                    <IconFile className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="max-w-[160px] truncate font-medium text-neutral-950 leading-tight">
                      {f.filename}
                    </div>
                    {f.doc_type && (
                      <div className="text-[10px] uppercase tracking-[0.04em] text-neutral-600 leading-tight">
                        {f.doc_type}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachedFile(f.id)}
                    aria-label={`Remove ${f.filename}`}
                    title="Remove attachment"
                    className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-200 hover:text-neutral-950 transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-2.5 w-2.5" aria-hidden="true">
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
            placeholder="Ask anything, upload files or images, or run operational commands..."
            aria-label="Message input"
            className="w-full resize-none bg-transparent text-sm text-neutral-950 placeholder:text-neutral-500 focus:outline-none leading-relaxed max-h-44"
          />

          {/* Bottom Bar Below Input Area */}
          <div className="flex items-center justify-between gap-2 pt-2">
            {/* Left Side: + Button, Persistence Capsule & Model-Name-Only Capsule */}
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
                  aria-expanded={isAddMenuOpen}
                  title="Upload files or images"
                  className={`h-8 w-8 rounded-full flex items-center justify-center active:scale-[0.98] transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1 ${
                    isAddMenuOpen
                      ? "bg-neutral-100 text-neutral-950"
                      : "text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100"
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleUploadFile}
                />

                {isAddMenuOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-60 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.14)] animate-fadeIn z-40">
                    {canUpload ? (
                      <div>
                        <button
                          type="button"
                          disabled={uploadingFile}
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium text-neutral-950 hover:bg-neutral-100 transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:opacity-50"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-neutral-600 shrink-0" aria-hidden="true">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                          </svg>
                          <span>{uploadingFile ? "Uploading..." : "Upload files or images"}</span>
                        </button>
                        {uploadError && (
                          <p className="px-2.5 pt-1 text-[11px] text-rose-700">{uploadError}</p>
                        )}
                      </div>
                    ) : (
                      <div className="px-2.5 py-2 text-xs text-neutral-600">
                        File upload restricted for your role
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Persistence Mode Capsule (Local / Neon) */}
              <button
                type="button"
                onClick={togglePersistence}
                disabled={persistenceLoading}
                title={`Active: ${persistenceMode === "neon" ? "Neon" : "Local"}. Click to switch persistence`}
                className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-neutral-800 bg-neutral-50 hover:bg-neutral-100 hover:text-neutral-950 border border-neutral-200 hover:border-neutral-300 active:scale-[0.98] transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1 select-none shrink-0 disabled:opacity-50"
              >
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${persistenceMode === "neon" ? "bg-blue-600" : "bg-emerald-600"}`} />
                <span>{persistenceMode === "neon" ? "Neon" : "Local"}</span>
              </button>

              {/* Small Model Capsule (Displays ONLY Model Name) */}
              <div ref={modelMenuRef} className="relative min-w-0">
                {isEngineer ? (
                  <div
                    className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-neutral-700 select-none cursor-default max-w-full"
                    title="Configured by Administrator. Contact system admin to change model."
                  >
                    <span className="truncate max-w-[230px]">
                      {activeModelShort}
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      setIsModelMenuOpen((v) => !v);
                    }}
                    aria-expanded={isModelMenuOpen}
                    title="Select AI model"
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium active:scale-[0.98] transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1 select-none max-w-full ${
                      isModelMenuOpen
                        ? "bg-neutral-100 text-neutral-950"
                        : "text-neutral-700 hover:text-neutral-950 hover:bg-neutral-100"
                    }`}
                  >
                    <span className="truncate max-w-[230px]">
                      {activeModelShort}
                    </span>
                    <IconChevronDown
                      className={`h-3.5 w-3.5 text-neutral-500 shrink-0 transition-transform duration-150 ease-out-quart ${
                        isModelMenuOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                )}

                {/* Compact Model Picker Popover */}
                {!isEngineer && isModelMenuOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-neutral-200 bg-white p-2 shadow-[0_12px_32px_rgba(15,23,42,0.14)] animate-fadeIn z-40 space-y-2">
                    <div className="relative">
                      <IconSearch className="absolute left-2.5 top-2 h-3.5 w-3.5 text-neutral-500" />
                      <input
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder="Search models..."
                        aria-label="Search models"
                        autoFocus
                        className="h-8 w-full rounded-xl border border-neutral-200 bg-neutral-50 pl-8 pr-2.5 text-xs text-neutral-950 placeholder:text-neutral-500 focus:border-neutral-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950/15"
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
                              className={`shrink-0 h-7 rounded-full px-2.5 text-[11px] font-medium transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
                                active
                                  ? "bg-neutral-950 text-white"
                                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 hover:text-neutral-950"
                              }`}
                            >
                              {formatProviderShortName(pid, pInfo?.name)}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="max-h-52 overflow-y-auto no-scrollbar space-y-0.5 pr-0.5">
                      {isFetchingModels && modelOptions.length === 0 ? (
                        <div className="px-2.5 py-3 text-xs text-neutral-500 text-center">
                          Loading models...
                        </div>
                      ) : modelOptions.length === 0 ? (
                        <div className="px-2.5 py-3 text-xs text-neutral-500 text-center">
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
                              className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
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
                                      isCurrent ? "text-neutral-300" : "text-neutral-500"
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

                    <div className="border-t border-neutral-200/70 pt-1.5">
                      <Link
                        href="/settings"
                        className="block rounded-xl px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                      >
                        API keys &amp; advanced setup in Settings &rarr;
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Side: Send Button */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={(!input.trim() && attachedFiles.length === 0) || loading}
                className="h-8 w-8 rounded-full bg-neutral-950 hover:bg-neutral-800 text-white flex items-center justify-center active:scale-[0.98] transition-[background-color,transform,opacity] duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                aria-label="Send message"
              >
                {loading ? (
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" strokeWidth="3" strokeDasharray="30" strokeDashoffset="10" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-4 w-4" aria-hidden="true">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
