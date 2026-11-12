// apps/web/components/chat-interface.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { post, getJSON } from "@/lib/api";
import { Badge, Button } from "@/components/ui/kit";

type ToolCall = {
  app: string;
  tool: string;
  connector: string;
  params: Record<string, any>;
  data: any;
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
};

const SUGGESTED_PROMPTS = [
  "Check SAP S/4HANA stock levels",
  "Show open GitHub issues & PRs",
  "Update dashboard production target to 1,200 units",
  "Set dashboard operational risk to LOW",
  "Check Siemens CAD revisions for DWG-4002",
  "Update OEE to 94% and operational status to Optimal",
];

export function ChatInterface({
  role,
  initialTools = [],
  initialConnections = [],
  initialOverrides = {},
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [connections, setConnections] = useState<MarketplaceConnection[]>(initialConnections);
  const [overrides, setOverrides] = useState<Record<string, any>>(initialOverrides);
  const [showToolDetails, setShowToolDetails] = useState<Record<string, boolean>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load history and tools on mount
  useEffect(() => {
    async function loadData() {
      try {
        const histRes = await getJSON<{ ok: boolean; messages: ChatMessage[] }>(
          "/api/execution/v1/chat/history"
        );
        if (histRes?.messages && histRes.messages.length > 0) {
          setMessages(histRes.messages);
        } else {
          // Default greeting
          setMessages([
            {
              id: "welcome-1",
              role: "assistant",
              content:
                "Hello! I am your Cawrys Industrial AI Assistant. I am directly integrated with your connected Marketplace tools (SAP S/4HANA, Siemens PLM, GitHub, Slack, etc.) and your live operational dashboard.\n\nAsk me to query stock, check engineering revisions, summarize issues, or update your dashboard targets and risk levels in real time.",
              timestamp: new Date().toISOString(),
            },
          ]);
        }

        const toolsRes = await getJSON<{
          ok: boolean;
          connections: MarketplaceConnection[];
          overrides: Record<string, any>;
        }>("/api/execution/v1/chat/tools");
        if (toolsRes?.connections) setConnections(toolsRes.connections);
        if (toolsRes?.overrides) setOverrides(toolsRes.overrides);
      } catch (err) {
        console.error("Failed to load initial chat tools:", err);
      }
    }
    loadData();
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function handleSend(promptText?: string) {
    const textToSend = (promptText || input).trim();
    if (!textToSend || loading) return;

    const userMsg: ChatMessage = {
      id: "u-" + Date.now(),
      role: "user",
      content: textToSend,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
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
        message: textToSend,
        session_id: "default",
        history: messages.slice(-10),
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
          content: `⚠️ Failed to execute: ${err.message || "An unexpected error occurred while communicating with the agent service."}`,
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

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col rounded-xl border border-white/10 bg-[#0a0b10] shadow-2xl overflow-hidden">
      {/* Top Banner: Marketplace Connected Tools & Dashboard Overrides */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/40 px-4 py-2.5 text-xs backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-neutral-300">Connected Data Toolkits:</span>
          {connections.length > 0 ? (
            connections.map((c) => (
              <Badge
                key={c.app_key}
                variant="success"
                className="py-0.5 text-[11px]"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {c.app_name}
              </Badge>
            ))
          ) : (
            <span className="text-neutral-500">FastMCP Industrial Tools Active (SAP, Siemens, Rockwell)</span>
          )}
          <Link
            href="/marketplace"
            className="rounded-md border border-white/10 px-2.5 py-0.5 text-neutral-400 hover:bg-white/5 hover:text-white transition"
          >
            + Connect Marketplace Tools
          </Link>
        </div>

        {hasOverrides && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-brand font-medium">⚡ Dashboard Targets:</span>
            {overrides.production_target && (
              <span className="text-neutral-300">Target: <strong className="text-white">{overrides.production_target}</strong></span>
            )}
            {overrides.risk_level && (
              <Badge
                variant={
                  overrides.risk_level === "LOW"
                    ? "success"
                    : overrides.risk_level === "HIGH"
                    ? "destructive"
                    : "warning"
                }
                className="font-bold py-0 text-[10px]"
              >
                {overrides.risk_level}
              </Badge>
            )}
            {overrides.oee && <span className="text-neutral-300">OEE: <strong className="text-white">{overrides.oee}</strong></span>}
            {overrides.operational_status && (
              <span className="text-neutral-300">Status: <strong className="text-white">{overrides.operational_status}</strong></span>
            )}
            <Link
              href="/"
              className="font-medium text-brand hover:underline flex items-center gap-1 text-xs"
            >
              View on Dashboard &rarr;
            </Link>
          </div>
        )}
      </div>

      {/* Suggested Prompts Pill Bar */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-white/5 bg-white/[0.01] px-4 py-2.5 text-xs">
        <span className="shrink-0 text-neutral-400 font-medium">Quick Prompts:</span>
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => handleSend(prompt)}
            className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-neutral-300 shadow-sm hover:border-brand/40 hover:bg-brand/10 hover:text-white transition-all duration-150 active:scale-95"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Message Feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m) => {
          const isUser = m.role === "user";
          const toolCall = m.tool_calls && m.tool_calls.length > 0 ? m.tool_calls[0] : null;

          return (
            <div
              key={m.id}
              className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
            >
              {!isUser && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/20 border border-brand/30 text-brand">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-4 w-4"
                  >
                    <path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM4 12a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM12 16a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2zM20 12a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed ${
                  isUser
                    ? "bg-brand text-white rounded-tr-none"
                    : "border border-white/10 bg-white/[0.04] text-neutral-200 rounded-tl-none shadow-md"
                }`}
              >
                {/* User message */}
                {isUser && <p className="whitespace-pre-wrap">{m.content}</p>}

                {/* Assistant message */}
                {!isUser && (
                  <div className="space-y-3">
                    <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap">
                      {m.content}
                    </div>

                    {/* Dashboard Mutation Highlight Box */}
                    {m.dashboard_mutated && (
                      <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-200">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-black font-bold">
                              ✓
                            </span>
                            <span className="font-semibold text-emerald-300">
                              Dashboard UI Updated
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

                <div
                  className={`mt-1.5 text-[10px] ${
                    isUser ? "text-white/70 text-right" : "text-neutral-500"
                  }`}
                >
                  {new Date(m.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>

              {isUser && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-neutral-300 font-semibold text-xs capitalize border border-white/15 shadow-sm">
                  {role[0]}
                </div>
              )}
            </div>
          );
        })}

        {loading && (
          <div className="flex gap-3 justify-start items-center">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/20 border border-brand/30 text-brand">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-4 w-4 animate-spin"
              >
                <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="10" />
              </svg>
            </div>
            <div className="rounded-2xl rounded-tl-none border border-white/10 bg-white/[0.04] p-3 text-xs text-neutral-400 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-brand animate-ping" />
              Querying connected data & synthesizing agent response...
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-white/10 bg-black/50 p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-end gap-2"
        >
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Chat with your connected data (e.g., 'Check SAP stock for Part 100') or update dashboard ('Change production target to 1,200')..."
              className="w-full resize-none rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-white placeholder-neutral-500 shadow-inner focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 transition-all"
            />
            <div className="absolute bottom-2 right-2 flex items-center gap-1.5 text-[10px] text-neutral-500">
              <span>Shift+Enter for newline</span>
            </div>
          </div>

          <Button
            type="submit"
            disabled={!input.trim() || loading}
            size="icon"
            className="h-12 w-12 rounded-xl shadow-lg shrink-0"
          >
            {loading ? (
              <svg
                className="h-5 w-5 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  strokeWidth="3"
                  strokeDasharray="30"
                  strokeDashoffset="10"
                />
              </svg>
            ) : (
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 2L11 13" />
                <path d="M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
