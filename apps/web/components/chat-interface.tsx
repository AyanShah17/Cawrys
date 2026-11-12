// apps/web/components/chat-interface.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { post, getJSON } from "@/lib/api";
import { Badge, Button } from "@/components/ui/kit";
import { ModeSwitcher } from "@/components/mode-switcher";
import {
  DEFAULT_LITELLM_CONFIG,
  LITELLM_CONFIG_EVENT,
  LITELLM_PROVIDERS,
  LiteLLMConfig,
  LiteLLMModal,
  loadLiteLLMConfig,
  saveLiteLLMConfig,
} from "./litellm-modal";
import {
  IconBolt,
  IconChart,
  IconCheck,
  IconFile,
  IconPlug,
  IconTune,
  ProviderBrandIcon,
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
  timestamp: string;
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

export function ChatInterface({
  role,
  initialTools = [],
  initialConnections = [],
  initialOverrides = {},
  initialDocsCount = 0,
}: ChatInterfaceProps) {
  const isEngineer = role === "engineer";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [connections, setConnections] = useState<MarketplaceConnection[]>(initialConnections);
  const [overrides, setOverrides] = useState<Record<string, any>>(initialOverrides);
  const [docsCount, setDocsCount] = useState<number>(initialDocsCount);
  const [modelConfig, setModelConfig] = useState<LiteLLMConfig>(DEFAULT_LITELLM_CONFIG);
  const [isLiteLLMModalOpen, setIsLiteLLMModalOpen] = useState(false);
  const [showToolDetails, setShowToolDetails] = useState<Record<string, boolean>>({});

  // Collapsible session & document drawer state
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [storedDocs, setStoredDocs] = useState<StoredDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<StoredDoc[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Check URL query parameters for ?configure_ai=1 or ?litellm=1 (only for admin)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      if ((sp.get("configure_ai") === "1" || sp.get("litellm") === "1") && !isEngineer) {
        setIsLiteLLMModalOpen(true);
      }
    }
  }, [isEngineer]);

  // Listen for real-time LiteLLM config updates
  useEffect(() => {
    function handleConfigChange(e: Event) {
      const customEvent = e as CustomEvent<LiteLLMConfig>;
      if (customEvent.detail) {
        setModelConfig(customEvent.detail);
      }
    }
    window.addEventListener(LITELLM_CONFIG_EVENT, handleConfigChange);
    return () => window.removeEventListener(LITELLM_CONFIG_EVENT, handleConfigChange);
  }, []);

  // Fetch stored documents from /api/intelligence/v1/documents
  useEffect(() => {
    async function loadDocuments() {
      setLoadingDocs(true);
      try {
        const res = await getJSON<any>("/api/intelligence/v1/documents?limit=50");
        const list: StoredDoc[] = Array.isArray(res) ? res : res?.items || [];
        setStoredDocs(list);
        if (list.length > 0) {
          setDocsCount(list.length);
        }
      } catch (err) {
        console.warn("Could not load stored documents:", err);
      } finally {
        setLoadingDocs(false);
      }
    }
    loadDocuments();
  }, []);

  // Load chat history, tools, and model config on mount
  useEffect(() => {
    const local = loadLiteLLMConfig();
    setModelConfig(local);

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

        // Fetch model config from execution backend
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
              provider: (cfgRes.provider in LITELLM_PROVIDERS)
                ? (cfgRes.provider as any)
                : local.provider,
              model: cfgRes.model || local.model,
              apiKey: cfgRes.api_key || local.apiKey || "",
              baseUrl: cfgRes.base_url || local.baseUrl || "",
            };
            setModelConfig(serverConfig);
            saveLiteLLMConfig(serverConfig);
          }
        } catch {
          // local config remains active
        }
      } catch (err) {
        console.error("Failed to load initial chat tools:", err);
      }
    }
    loadData();
  }, []);

  async function handleSaveModelConfig(newConfig: LiteLLMConfig) {
    if (isEngineer) return; // Role guard
    setModelConfig(newConfig);
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

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

  // Start new chat session
  function handleNewChat() {
    setMessages([]);
    setAttachedFiles([]);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  // Toggle attaching a stored document to active chat context chip
  function toggleAttachDocument(doc: StoredDoc) {
    setAttachedFiles((prev) => {
      const exists = prev.some((d) => d.id === doc.id);
      if (exists) {
        return prev.filter((d) => d.id !== doc.id);
      }
      return [...prev, doc];
    });
  }

  // Remove attached file chip
  function removeAttachedFile(id: string) {
    setAttachedFiles((prev) => prev.filter((d) => d.id !== id));
  }

  async function handleSend(promptText?: string) {
    const rawText = (promptText || input).trim();
    if (!rawText || loading) return;

    // Build context with attached files if any
    const attachedContextStr =
      attachedFiles.length > 0
        ? `\n\n[Referencing Attached Documents: ${attachedFiles
            .map((f) => `${f.filename} (${f.doc_type || "Document"})`)
            .join(", ")}]`
        : "";

    const fullMessageText = rawText + attachedContextStr;

    const currentAttachments = [...attachedFiles];

    const userMsg: ChatMessage = {
      id: "u-" + Date.now(),
      role: "user",
      content: rawText,
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
        tool_calls: response.tool_calls || (response.metadata?.tool_call ? [response.metadata.tool_call] : undefined),
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
          content: `Failed to execute: ${err.message || "An unexpected error occurred while communicating with the agent service."}`,
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

  const hasOverrides = overrides && Object.keys(overrides).length > 0;
  const isChatEmpty = messages.length === 0;

  return (
    <div className="flex h-[calc(100vh-8.5rem)] rounded-2xl border border-white/10 bg-[#07080d] shadow-2xl overflow-hidden">
      {/* 1. LEFT COLLAPSIBLE SESSION & DOCUMENT DRAWER */}
      <aside
        className={`shrink-0 border-r border-white/10 bg-neutral-950/70 backdrop-blur-xl flex flex-col transition-all duration-300 ease-in-out ${
          isDrawerOpen ? "w-72 md:w-80" : "w-0 -translate-x-full opacity-0 pointer-events-none border-r-0"
        }`}
      >
        <div className="p-3.5 border-b border-white/10 flex items-center justify-between gap-2">
          {/* + New Chat Button */}
          <button
            type="button"
            onClick={handleNewChat}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] py-2 px-3 text-xs font-semibold text-white shadow-sm hover:border-white/30 hover:bg-white/[0.08] active:scale-95 transition-all"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-4 w-4 text-brand">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>+ New Chat</span>
          </button>

          {/* Close Drawer Button */}
          <button
            type="button"
            onClick={() => setIsDrawerOpen(false)}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white transition"
            title="Collapse drawer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <path d="M14 9l-3 3 3 3" />
            </svg>
          </button>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-5">
          {/* SECTION: Stored Files */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                <IconFile className="h-3.5 w-3.5 text-brand" />
                <span>Stored Files</span>
              </span>
              <span className="rounded-full bg-white/10 px-1.5 py-0.2 text-[10px] font-mono text-neutral-300">
                {storedDocs.length}
              </span>
            </div>
            <p className="px-1 text-[11px] text-neutral-500 leading-tight">
              Click a file to attach to active agent context
            </p>

            <div className="space-y-1 pt-1 max-h-56 overflow-y-auto pr-1">
              {loadingDocs ? (
                <div className="p-3 text-center text-xs text-neutral-500">Loading files...</div>
              ) : storedDocs.length === 0 ? (
                <div className="p-3 text-center text-xs text-neutral-500 border border-white/5 rounded-lg bg-black/20">
                  <span>No stored files.</span>{" "}
                  <Link href="/documents" className="text-brand underline">
                    Upload CAD / PDF &rarr;
                  </Link>
                </div>
              ) : (
                storedDocs.map((doc) => {
                  const isAttached = attachedFiles.some((f) => f.id === doc.id);
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => toggleAttachDocument(doc)}
                      className={`w-full group flex items-center justify-between rounded-lg p-2 text-left text-xs transition-all ${
                        isAttached
                          ? "bg-brand/20 border border-brand/40 text-white shadow-sm ring-1 ring-brand/30"
                          : "border border-white/5 bg-white/[0.02] text-neutral-300 hover:border-white/15 hover:bg-white/[0.05]"
                      }`}
                      title={doc.filename}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          className={`h-3.5 w-3.5 shrink-0 ${isAttached ? "text-brand" : "text-neutral-500 group-hover:text-neutral-300"}`}
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <div className="min-w-0">
                          <div className="truncate font-mono text-[11px] text-neutral-200">
                            {doc.filename}
                          </div>
                          {doc.doc_type && (
                            <div className="text-[10px] text-neutral-500 uppercase">{doc.doc_type}</div>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 ml-1.5">
                        {isAttached ? (
                          <span className="rounded bg-brand px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm">
                            Attached
                          </span>
                        ) : (
                          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-neutral-400 group-hover:text-white">
                            + Attach
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* SECTION: Pre-configured Connectors Badge List */}
          <div className="space-y-2 border-t border-white/10 pt-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                <IconPlug className="h-3.5 w-3.5 text-emerald-400" />
                <span>Active Connectors</span>
              </span>
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>

            <div className="space-y-1.5 pt-1">
              {connections.length > 0 ? (
                connections.map((c) => (
                  <div
                    key={c.app_key}
                    className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-xs text-neutral-300"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="truncate font-medium text-white">{c.app_name}</span>
                    </div>
                    <Badge variant="success" className="text-[9px] py-0 px-1.5">
                      Ready
                    </Badge>
                  </div>
                ))
              ) : (
                <>
                  <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-xs text-neutral-300">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      <span className="font-medium text-white">SAP S/4HANA</span>
                    </div>
                    <Badge variant="outline" className="text-[9px] py-0 px-1.5 text-neutral-400">
                      FastMCP
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-xs text-neutral-300">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      <span className="font-medium text-white">Siemens PLM</span>
                    </div>
                    <Badge variant="outline" className="text-[9px] py-0 px-1.5 text-neutral-400">
                      FastMCP
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-xs text-neutral-300">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      <span className="font-medium text-white">Rockwell Automation</span>
                    </div>
                    <Badge variant="outline" className="text-[9px] py-0 px-1.5 text-neutral-400">
                      FastMCP
                    </Badge>
                  </div>
                </>
              )}
            </div>
            <div className="pt-1">
              <Link
                href="/connectors"
                className="text-[11px] text-neutral-400 hover:text-white flex items-center justify-between px-1"
              >
                <span>View all connectors</span>
                <span>&rarr;</span>
              </Link>
            </div>
          </div>
        </div>
      </aside>

      {/* 2. MAIN CONVERSATION PANE */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative bg-[#07080d]">
        {/* Top Floating Header Bar */}
        <header className="border-b border-white/10 bg-black/60 px-4 py-2.5 backdrop-blur-md flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            {!isDrawerOpen && (
              <button
                type="button"
                onClick={() => setIsDrawerOpen(true)}
                className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-neutral-300 hover:bg-white/10 hover:text-white transition shadow-sm"
                title="Expand sessions & documents drawer"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                  <path d="M11 12h6M14 9l3 3-3 3" />
                </svg>
              </button>
            )}

            {/* Top Pill Mode Switcher */}
            <ModeSwitcher size="sm" />
          </div>

          {/* Right Status Indicators */}
          <div className="flex items-center gap-2 text-xs">
            {hasOverrides ? (
              <Link
                href="/"
                className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-300 hover:bg-emerald-500/20 transition shadow-sm font-medium"
              >
                <IconBolt className="h-3 w-3 text-emerald-400" />
                <span>Dashboard Synced:</span>
                <span className="font-bold text-white">
                  {overrides.production_target || overrides.oee || "Active"}
                </span>
              </Link>
            ) : (
              <Link
                href="/"
                className="hidden sm:flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-neutral-300 hover:bg-white/[0.08] transition shadow-sm"
              >
                <IconChart className="h-3 w-3 text-neutral-400" />
                <span>Live Dashboard</span>
              </Link>
            )}
          </div>
        </header>

        {/* Conversation Feed */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto w-full space-y-6">
            {/* Empty State Hero & Quick Action Cards */}
            {isChatEmpty ? (
              <div className="pt-8 pb-4 space-y-8 animate-fadeIn">
                {/* Hero Header */}
                <div className="text-center space-y-3">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-gradient-to-tr from-brand/30 to-white/10 text-brand shadow-lg">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold tracking-tight text-white">
                    Cawrys Industrial Intelligence
                  </h2>
                  <p className="text-sm text-neutral-400 max-w-lg mx-auto leading-relaxed">
                    Autonomous plant orchestration, CAD engineering analysis, and live telemetry execution powered by unified foundation models.
                  </p>
                </div>

                {/* Quick Action Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  {QUICK_ACTION_CARDS.map((card) => (
                    <button
                      key={card.title}
                      type="button"
                      onClick={() => handleSend(card.prompt)}
                      className="group rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition-all duration-200 hover:border-brand/40 hover:bg-brand/[0.06] hover:shadow-lg active:scale-[0.98]"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-sm font-semibold text-white group-hover:text-brand transition-colors">
                          {card.title}
                        </span>
                        <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-medium text-neutral-400 group-hover:text-neutral-200">
                          {card.tag}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-400 leading-relaxed group-hover:text-neutral-300">
                        {card.subtitle}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Message Bubbles */
              messages.map((m) => {
                const isUser = m.role === "user";
                const toolCall = m.tool_calls && m.tool_calls.length > 0 ? m.tool_calls[0] : null;
                const userAttached = m.metadata?.attached_files as Array<{ id: string; filename: string }> | undefined;

                return (
                  <div
                    key={m.id}
                    className={`flex gap-3.5 ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    {!isUser && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand/20 border border-brand/30 text-brand shadow-sm mt-0.5">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                      </div>
                    )}

                    <div
                      className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed ${
                        isUser
                          ? "bg-brand text-white rounded-tr-none shadow-md"
                          : "border border-white/10 bg-neutral-900/60 backdrop-blur-md text-neutral-200 rounded-tl-none shadow-lg"
                      }`}
                    >
                      {/* Attached files chip list on user message */}
                      {isUser && userAttached && userAttached.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5 pb-2 border-b border-white/20">
                          {userAttached.map((f) => (
                            <span
                              key={f.id}
                              className="inline-flex items-center gap-1 rounded-md bg-white/20 px-2 py-0.5 text-[11px] font-mono text-white"
                            >
                              <IconFile className="h-3 w-3" />
                              <span>{f.filename}</span>
                            </span>
                          ))}
                        </div>
                      )}

                      {/* User message content */}
                      {isUser && <p className="whitespace-pre-wrap">{m.content}</p>}

                      {/* Assistant message content */}
                      {!isUser && (
                        <div className="space-y-3">
                          <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap leading-relaxed">
                            {m.content}
                          </div>

                          {/* Dashboard Mutation Highlight Box */}
                          {m.dashboard_mutated && (
                            <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-200">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-black">
                                    <IconCheck className="h-3 w-3 stroke-[3]" />
                                  </span>
                                  <span className="font-semibold text-emerald-300">
                                    Live Dashboard Overrides Applied
                                  </span>
                                </div>
                                <Link
                                  href="/"
                                  className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2.5 py-1 font-medium text-emerald-200 hover:bg-emerald-500/30 transition"
                                >
                                  Open Dashboard &rarr;
                                </Link>
                              </div>
                              {m.overrides && (
                                <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-emerald-500/20 pt-2 text-[11px] text-emerald-300">
                                  {m.overrides.production_target && (
                                    <div>
                                      <span className="text-emerald-400/80">Target: </span>
                                      <b>{m.overrides.production_target}</b>
                                    </div>
                                  )}
                                  {m.overrides.risk_level && (
                                    <div>
                                      <span className="text-emerald-400/80">Risk Level: </span>
                                      <b>{m.overrides.risk_level}</b>
                                    </div>
                                  )}
                                  {m.overrides.oee && (
                                    <div>
                                      <span className="text-emerald-400/80">OEE: </span>
                                      <b>{m.overrides.oee}</b>
                                    </div>
                                  )}
                                  {m.overrides.operational_status && (
                                    <div>
                                      <span className="text-emerald-400/80">Status: </span>
                                      <b>{m.overrides.operational_status}</b>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Connected Tool Execution Card */}
                          {toolCall && (
                            <div className="mt-3 rounded-lg border border-white/10 bg-black/40 p-3 text-xs">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="rounded bg-brand/20 px-1.5 py-0.5 font-mono text-[11px] text-brand">
                                    {toolCall.connector.toUpperCase()}
                                  </span>
                                  <span className="font-semibold text-neutral-300">
                                    {toolCall.app} &middot; {toolCall.tool}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => toggleToolDetails(m.id)}
                                  className="text-[11px] text-neutral-400 hover:text-white underline"
                                >
                                  {showToolDetails[m.id] ? "Hide payload" : "Inspect payload"}
                                </button>
                              </div>

                              {showToolDetails[m.id] && (
                                <pre className="mt-2 overflow-x-auto rounded bg-black/70 p-2 font-mono text-[11px] text-neutral-400">
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

                      {/* Timestamp & Routing Badges */}
                      {isUser ? (
                        <div className="mt-1.5 text-[10px] text-white/70 text-right">
                          {new Date(m.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      ) : (
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-1.5 text-[10px] text-neutral-400">
                          <div className="flex flex-wrap items-center gap-1.5 font-mono">
                            <span className="flex items-center gap-1 text-brand font-medium">
                              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                              via {m.metadata?.model || modelConfig.model}
                            </span>
                            {m.metadata?.live_ai ? (
                              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300 border border-emerald-500/30">
                                Live AI
                              </span>
                            ) : (
                              <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] text-neutral-400 border border-white/5">
                                Context Engine
                              </span>
                            )}
                            {m.metadata?.latency_ms !== undefined && (
                              <>
                                <span className="text-neutral-600">·</span>
                                <span>{m.metadata.latency_ms}ms</span>
                              </>
                            )}
                            {m.metadata?.provider && (
                              <>
                                <span className="text-neutral-600">·</span>
                                <span className="capitalize">{m.metadata.provider}</span>
                              </>
                            )}
                          </div>
                          <span>
                            {new Date(m.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      )}
                    </div>

                    {isUser && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-neutral-200 font-semibold text-xs capitalize border border-white/15 shadow-sm mt-0.5">
                        {role[0]}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* Loading Indicator */}
            {loading && (
              <div className="flex gap-3 justify-start items-center">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand/20 border border-brand/30 text-brand">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 animate-spin">
                    <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="10" />
                  </svg>
                </div>
                <div className="rounded-2xl rounded-tl-none border border-white/10 bg-neutral-900/60 p-3 text-xs text-neutral-300 flex items-center gap-2 shadow-sm">
                  <span className="h-2 w-2 rounded-full bg-brand animate-ping" />
                  Synthesizing agent response &amp; evaluating operational tools...
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 3. FLOATING BOTTOM DOCK (Grok / ChatGPT style) */}
        <div className="relative z-20 pb-4 px-4 max-w-3xl mx-auto w-full">
          <div className="rounded-2xl border border-white/15 bg-neutral-900/90 backdrop-blur-xl shadow-2xl p-3 space-y-2.5 transition-all focus-within:border-white/30 focus-within:ring-1 focus-within:ring-brand/30">
            {/* Attached Document Context Chips Row */}
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pb-1 border-b border-white/10">
                <span className="text-[11px] text-neutral-400 font-medium mr-1 flex items-center gap-1">
                  <IconFile className="h-3 w-3 text-brand" />
                  <span>Attached:</span>
                </span>
                {attachedFiles.map((f) => (
                  <span
                    key={f.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/15 px-2.5 py-1 text-xs font-mono text-white shadow-sm"
                  >
                    <span className="max-w-[180px] truncate">{f.filename}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachedFile(f.id)}
                      className="text-neutral-400 hover:text-white transition rounded p-0.5"
                      title="Remove attachment"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Prompt Textarea */}
            <div className="relative">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message Cawrys Industrial Intelligence or run operational commands..."
                className="w-full resize-none bg-transparent text-sm text-white placeholder-neutral-500 focus:outline-none transition-all leading-relaxed max-h-48"
              />
            </div>

            {/* Bottom Dock Toolbar */}
            <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-2">
              <div className="flex items-center gap-2">
                {/* Model Selector Chip: Read-only for engineer, Clickable for admin */}
                {isEngineer ? (
                  <div
                    className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-neutral-300 select-none cursor-default"
                    title="Configured by Administrator. Contact system admin to change model."
                  >
                    <ProviderBrandIcon provider={modelConfig.provider} className="h-3.5 w-3.5 text-brand" />
                    <span className="font-semibold text-white">
                      {LITELLM_PROVIDERS[modelConfig.provider]?.name || modelConfig.provider}
                    </span>
                    <span className="text-neutral-600">·</span>
                    <span className="font-mono text-neutral-400 text-[11px] max-w-[140px] truncate">
                      {modelConfig.model.split("/").pop() || modelConfig.model}
                    </span>
                    <span className="ml-1 rounded bg-white/10 px-1.5 py-0.2 text-[9px] font-medium text-neutral-400 border border-white/5 flex items-center gap-1">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-2.5 w-2.5 text-neutral-400">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                      <span>Admin Configured</span>
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsLiteLLMModalOpen(true)}
                    className="group flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-medium text-white shadow-sm transition-all hover:border-brand hover:bg-brand/20 active:scale-95"
                    title="Click to configure AI Provider, Model, and API Key"
                  >
                    <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <ProviderBrandIcon provider={modelConfig.provider} className="h-3.5 w-3.5 text-brand" />
                    <span className="font-semibold text-brand">LiteLLM:</span>
                    <span className="text-neutral-200">
                      {LITELLM_PROVIDERS[modelConfig.provider]?.name || modelConfig.provider}
                    </span>
                    <span className="text-neutral-600">·</span>
                    <span className="font-mono text-neutral-300 text-[11px] max-w-[140px] truncate">
                      {modelConfig.model.split("/").pop() || modelConfig.model}
                    </span>
                    <IconTune className="h-3.5 w-3.5 text-neutral-400 group-hover:text-white transition-colors" />
                  </button>
                )}

                {/* Attach File Button to Toggle Drawer */}
                {!isDrawerOpen && (
                  <button
                    type="button"
                    onClick={() => setIsDrawerOpen(true)}
                    className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-neutral-400 hover:bg-white/[0.08] hover:text-white transition"
                    title="Attach Stored File"
                  >
                    <IconFile className="h-3 w-3" />
                    <span>Attach File</span>
                  </button>
                )}
              </div>

              {/* Send Button */}
              <Button
                type="button"
                onClick={() => handleSend()}
                disabled={(!input.trim() && attachedFiles.length === 0) || loading}
                size="sm"
                className="h-8 px-3.5 rounded-xl shadow-lg shrink-0 gap-1.5"
              >
                {loading ? (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="12" cy="12" r="10" strokeWidth="3" strokeDasharray="30" strokeDashoffset="10" />
                  </svg>
                ) : (
                  <>
                    <span>Send</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-3.5 w-3.5">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* LiteLLM Model Modal (Role-guarded) */}
      <LiteLLMModal
        isOpen={isLiteLLMModalOpen}
        onClose={() => setIsLiteLLMModalOpen(false)}
        currentConfig={modelConfig}
        onSave={handleSaveModelConfig}
        role={role}
        readOnly={isEngineer}
      />
    </div>
  );
}
