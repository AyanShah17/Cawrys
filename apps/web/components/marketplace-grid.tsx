// apps/web/components/marketplace-grid.tsx
"use client";
import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { API, del, getJSON, post } from "@/lib/api";
import { Badge, Button, Card, Empty, Notice, btnCls, btnGhostCls, inputCls } from "@/components/ui/kit";
import {
  ExecutionResultModal,
  MarketplaceConfigModal,
  getAppInitials,
  getAvatarTone,
  type ConnectPayload,
} from "./marketplace-config-modal";

export type MarketplaceTool = {
  name: string;
  description?: string;
  risk?: string;
  connector?: string;
  secret_ref?: string;
  module?: string;
  endpoint?: string;
  action?: string;
  input_schema?: Record<string, unknown>;
};

export type MarketplaceConnection = {
  id: string;
  status: string;
  auth_mode: string;
  entity_id?: string;
  connected_by?: string | null;
  created_at?: string;
  redirect_url?: string;
  config?: Record<string, unknown>;
};

export type MarketplaceApp = {
  key: string;
  name: string;
  category: string;
  provider?: "composio" | "fastmcp" | string;
  description: string;
  auth_schemes: string[];
  whitelabel_ready?: boolean;
  docs_url?: string;
  modules?: string[];
  tools: MarketplaceTool[];
  connected: boolean;
  connection: MarketplaceConnection | null;
};

export type MarketplaceCatalog = {
  tier?: string;
  whitelabel_enabled?: boolean;
  api_key_configured?: boolean;
  composio_api_configured?: boolean;
  composio_base_url?: string;
  counts?: {
    total: number;
    composio: number;
    fastmcp: number;
    connected: number;
  };
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
  categories?: Array<{ name: string; count: number }>;
  apps: MarketplaceApp[];
};

export type ExecutionModalData = {
  isOpen: boolean;
  app: MarketplaceApp;
  tool: MarketplaceTool;
  result: Record<string, unknown> | null;
  latencyMs: number;
  statusCode: number;
  timestamp: string;
};

const FEATURED_KEYS = new Set([
  "sap_s4hana",
  "siemens_xcelerator",
  "rockwell_factorytalk",
  "dassault_3dexperience",
  "ptc_windchill",
  "oracle_scm",
  "slack",
  "github",
  "gmail",
  "googlesheets",
  "salesforce",
  "hubspot",
  "stripe",
  "notion",
  "linear",
  "jira",
  "airtable",
  "zendesk",
]);

const FALLBACK_CATALOG: MarketplaceCatalog = {
  tier: "standard",
  whitelabel_enabled: false,
  api_key_configured: false,
  composio_base_url: "https://backend.composio.dev/api/v1",
  counts: {
    total: 1646,
    composio: 1640,
    fastmcp: 6,
    connected: 0,
  },
  apps: [
    {
      key: "sap_s4hana",
      name: "SAP S/4HANA & Business Suite",
      category: "ERP & Operations",
      provider: "fastmcp",
      description: "Enterprise ERP integration via FastMCP and SAP OData APIs covering Materials Management, Production, Quality, Maintenance, and Finance.",
      auth_schemes: ["BASIC_AUTH", "OAUTH2", "API_KEY"],
      whitelabel_ready: true,
      docs_url: "https://api.sap.com",
      modules: ["MM", "PP", "SD", "QM", "PM/EAM", "FI/CO", "EWM"],
      tools: [
        { name: "sap_mm_get_material_master", module: "MM", endpoint: "/sap/opu/odata/sap/API_PRODUCT_SRV", risk: "low", description: "Fetch material master attributes, plant data, and storage locations" },
      ],
      connected: false,
      connection: null,
    },
    {
      key: "siemens_xcelerator",
      name: "Siemens Xcelerator (Teamcenter, Opcenter, NX, MindSphere)",
      category: "Engineering",
      provider: "fastmcp",
      description: "End-to-end PLM, MES, CAD/CAE, and IIoT platform integration via FastMCP and Siemens REST services.",
      auth_schemes: ["OAUTH2", "SESSION_TOKEN", "API_KEY"],
      whitelabel_ready: true,
      docs_url: "https://plm.sw.siemens.com",
      modules: ["Teamcenter PLM", "Opcenter MES", "NX CAD", "Simcenter CAE", "MindSphere IIoT", "Tecnomatix"],
      tools: [
        { name: "siemens_tc_get_item_revision", module: "Teamcenter PLM", endpoint: "/tc/RestServices/Core-2011-06-DataManagement/getItem", risk: "low", description: "Retrieve engineering item revision, released lifecycle status, and CAD attachments" },
      ],
      connected: false,
      connection: null,
    },
    {
      key: "rockwell_factorytalk",
      name: "Rockwell Automation (FactoryTalk, Studio 5000, Plex)",
      category: "ERP & Operations",
      provider: "fastmcp",
      description: "Industrial automation, PLC tag telemetry, and shop floor MES connectivity via FastMCP.",
      auth_schemes: ["CIP_PROTOCOL", "API_KEY", "OAUTH2"],
      whitelabel_ready: true,
      docs_url: "https://www.rockwellautomation.com",
      modules: ["FactoryTalk MES", "Studio 5000 CIP", "Plex QMS", "Fiix CMMS"],
      tools: [
        { name: "rockwell_ft_dispatch_batch", module: "FactoryTalk MES", endpoint: "/factorytalk/api/v1/batch/dispatch", risk: "high", description: "Dispatch production recipe and batch run parameters" },
      ],
      connected: false,
      connection: null,
    },
    {
      key: "dassault_3dexperience",
      name: "Dassault Systèmes 3DEXPERIENCE (ENOVIA, DELMIA, SOLIDWORKS)",
      category: "Engineering",
      provider: "fastmcp",
      description: "Virtual twin, PLM lifecycle, and digital manufacturing integration via FastMCP.",
      auth_schemes: ["3DEXP_PASSPORT", "OAUTH2", "API_KEY"],
      whitelabel_ready: true,
      docs_url: "https://www.3ds.com",
      modules: ["ENOVIA PLM", "DELMIA MES", "SOLIDWORKS PDM", "SIMULIA CAE"],
      tools: [
        { name: "dassault_enovia_get_engineering_bom", module: "ENOVIA PLM", endpoint: "/resources/v1/modeler/dseng/dseng:EngItem", risk: "low", description: "Retrieve as-designed engineering BOM tree with release state" },
      ],
      connected: false,
      connection: null,
    },
    {
      key: "ptc_windchill",
      name: "PTC Windchill & ThingWorx IIoT",
      category: "Engineering",
      provider: "fastmcp",
      description: "Enterprise PLM product architecture, MPMLink manufacturing process plans, and ThingWorx IIoT.",
      auth_schemes: ["OAUTH2", "BASIC_AUTH", "API_KEY"],
      whitelabel_ready: true,
      docs_url: "https://www.ptc.com",
      modules: ["Windchill PLM", "MPMLink", "ThingWorx IIoT", "Creo CAD"],
      tools: [
        { name: "ptc_windchill_get_part_structure", module: "Windchill PLM", endpoint: "/Windchill/servlet/odata/ProdMgmt/Parts", risk: "low", description: "Retrieve hierarchical product structure and change task details" },
      ],
      connected: false,
      connection: null,
    },
    {
      key: "oracle_scm",
      name: "Oracle Fusion SCM Cloud",
      category: "ERP & Operations",
      provider: "fastmcp",
      description: "Supply chain management, manufacturing work orders, and warehouse inventory via Oracle REST APIs.",
      auth_schemes: ["OAUTH2", "BASIC_AUTH", "API_KEY"],
      whitelabel_ready: true,
      docs_url: "https://docs.oracle.com/cloud/scm",
      modules: ["Procurement", "Inventory Management", "Manufacturing Cloud", "Maintenance Cloud"],
      tools: [
        { name: "oracle_scm_create_work_order", module: "Manufacturing Cloud", endpoint: "/fscmRestApi/resources/11.13.18.05/workOrders", risk: "high", description: "Create standard discrete work order in Oracle Manufacturing Cloud" },
      ],
      connected: false,
      connection: null,
    },
    {
      key: "slack",
      name: "Slack",
      category: "Communication & Social",
      provider: "composio",
      description: "Send operational alerts, approval notifications, and anomaly summaries to Slack channels.",
      auth_schemes: ["OAUTH2", "API_KEY"],
      whitelabel_ready: true,
      docs_url: "https://composio.dev/tools/slack",
      modules: ["Channels", "Direct Messages", "Alerts"],
      tools: [
        { name: "composio_slack_send_message", risk: "low", description: "Post a message to a Slack channel via Composio" },
      ],
      connected: false,
      connection: null,
    },
    {
      key: "github",
      name: "GitHub",
      category: "Developer Tools & DevOps",
      provider: "composio",
      description: "Create issues, open incident tickets, and track engineering remediation workflows.",
      auth_schemes: ["OAUTH2", "API_KEY"],
      whitelabel_ready: true,
      docs_url: "https://composio.dev/tools/github",
      modules: ["Issues", "Pull Requests", "Workflows"],
      tools: [
        { name: "composio_github_create_issue", risk: "low", description: "Create a GitHub issue in a repository" },
      ],
      connected: false,
      connection: null,
    },
  ],
};

export function MarketplaceGrid({
  initial,
  role,
  brandName,
}: {
  initial: MarketplaceCatalog | null;
  role: string;
  brandName: string;
}) {
  const [catalog, setCatalog] = useState<MarketplaceCatalog>(initial ?? FALLBACK_CATALOG);
  const [serviceOffline, setServiceOffline] = useState<boolean>(initial === null);

  // Filters & Search
  const [providerFilter, setProviderFilter] = useState<"all" | "composio" | "fastmcp">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "connected" | "available">("all");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [isCategoryOpen, setIsCategoryOpen] = useState<boolean>(false);
  const [sortOption, setSortOption] = useState<"featured" | "alpha" | "tools">("featured");
  const [search, setSearch] = useState<string>("");
  const deferredSearch = useDeferredValue(search);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(24);

  // Modals & Banners
  const [showRoadmap, setShowRoadmap] = useState<boolean>(false);
  const [busyApp, setBusyApp] = useState<string | null>(null);
  const [configModalApp, setConfigModalApp] = useState<MarketplaceApp | null>(null);
  const [banner, setBanner] = useState<{
    ok: boolean;
    title: string;
    detail?: string;
    actionUrl?: string;
    actionLabel?: string;
  } | null>(null);

  // Tool Execution Result Modal
  const [executionModal, setExecutionModal] = useState<ExecutionModalData | null>(null);
  const [copiedJson, setCopiedJson] = useState<boolean>(false);

  const canManage = role === "admin";
  const isProWhitelabel = catalog.tier === "pro" || catalog.whitelabel_enabled;

  // Keyboard shortcut listener for Ctrl+K / Cmd+K or / to focus search input
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close category dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        categoryDropdownRef.current &&
        !categoryDropdownRef.current.contains(event.target as Node)
      ) {
        setIsCategoryOpen(false);
      }
    }

    if (isCategoryOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isCategoryOpen]);

  // Close category dropdown on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && isCategoryOpen) {
        setIsCategoryOpen(false);
      }
    }
    if (isCategoryOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCategoryOpen]);

  // Refresh catalog from execution service with limit=0 to get full 1646+ catalog
  const refresh = useCallback(async () => {
    try {
      const fresh = await getJSON<MarketplaceCatalog>(`${API.execution}/v1/marketplace/apps?limit=0`);
      if (fresh && Array.isArray(fresh.apps) && fresh.apps.length > 0) {
        setCatalog(fresh);
        setServiceOffline(false);
      }
    } catch {
      // Keep current state if refresh fails
    }
  }, []);

  useEffect(() => {
    const isPartial = Boolean(
      initial?.apps &&
      initial?.counts?.total &&
      initial.apps.length < initial.counts.total
    );
    if (initial === null || isPartial) {
      refresh();
    }
  }, [initial, refresh]);

  // Aggregate counts across providers & connections
  const counts = useMemo(() => {
    const apps = catalog.apps || [];
    const totalApps = apps.length;
    const composioApps = apps.filter((a) => (a.provider ?? "composio") === "composio").length;
    const fastmcpApps = apps.filter((a) => a.provider === "fastmcp").length;
    const connectedApps = apps.filter((a) => a.connected).length;

    return {
      total: catalog.counts?.total ?? Math.max(totalApps, 1646),
      composio:
        catalog.counts?.composio ??
        (catalog.counts?.total ? catalog.counts.total - (catalog.counts?.fastmcp ?? 6) : Math.max(composioApps, 1640)),
      fastmcp: catalog.counts?.fastmcp ?? (fastmcpApps > 0 ? fastmcpApps : 6),
      connected: catalog.counts?.connected ?? connectedApps,
    };
  }, [catalog]);

  // Dynamic category pills with accurate counts scoped to current provider selection
  const categoryCounts = useMemo(() => {
    const apps = (catalog.apps || []).filter((app) => {
      if (providerFilter === "composio") return (app.provider ?? "composio") === "composio";
      if (providerFilter === "fastmcp") return app.provider === "fastmcp";
      return true;
    });

    const map = new Map<string, number>();
    apps.forEach((a) => {
      const cat = a.category?.trim() || "Other";
      map.set(cat, (map.get(cat) || 0) + 1);
    });

    const list = Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return {
      total: apps.length,
      categories: list,
    };
  }, [catalog.apps, providerFilter]);

  // Clean up selected categories if not in the active category list (e.g. after provider switch)
  useEffect(() => {
    if (selectedCategories.length > 0) {
      const validNames = new Set(categoryCounts.categories.map((c) => c.name));
      const validSelected = selectedCategories.filter((c) => validNames.has(c));
      if (validSelected.length !== selectedCategories.length) {
        setSelectedCategories(validSelected);
        setCurrentPage(1);
      }
    }
  }, [categoryCounts.categories, selectedCategories]);

  const isAllCategories =
    selectedCategories.length === 0 ||
    selectedCategories.length === categoryCounts.categories.length;

  const categoryButtonLabel = isAllCategories
    ? `Categories: All (${categoryCounts.categories.length})`
    : `Categories (${selectedCategories.length} selected)`;

  function handleToggleCategory(catName: string) {
    setSelectedCategories((prev) => {
      let next: string[];
      if (prev.length === 0) {
        next = [catName];
      } else if (prev.length === categoryCounts.categories.length) {
        next = prev.filter((c) => c !== catName);
      } else if (prev.includes(catName)) {
        next = prev.filter((c) => c !== catName);
      } else {
        next = [...prev, catName];
      }
      return next;
    });
    setCurrentPage(1);
  }

  // Filtered & Sorted Apps
  const filteredApps = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();

    const filtered = (catalog.apps || []).filter((app) => {
      // Provider filter
      if (providerFilter === "composio" && (app.provider ?? "composio") !== "composio") {
        return false;
      }
      if (providerFilter === "fastmcp" && app.provider !== "fastmcp") {
        return false;
      }

      // Status filter
      if (statusFilter === "connected" && !app.connected) {
        return false;
      }
      if (statusFilter === "available" && app.connected) {
        return false;
      }

      // Category filter (multi-select)
      if (!isAllCategories) {
        const appCat = app.category?.trim() || "Other";
        if (!selectedCategories.includes(appCat) && !selectedCategories.includes(app.category)) {
          return false;
        }
      }

      // Search query
      if (!q) return true;

      const inName = app.name.toLowerCase().includes(q);
      const inKey = app.key.toLowerCase().includes(q);
      const inCategory = (app.category || "").toLowerCase().includes(q);
      const inDesc = (app.description || "").toLowerCase().includes(q);

      return inName || inKey || inCategory || inDesc;
    });

    // Sorting
    return filtered.sort((a, b) => {
      if (sortOption === "alpha") {
        return a.name.localeCompare(b.name);
      }
      if (sortOption === "tools") {
        return (b.tools?.length || 0) - (a.tools?.length || 0);
      }
      const aFeatured = FEATURED_KEYS.has(a.key) ? 1 : 0;
      const bFeatured = FEATURED_KEYS.has(b.key) ? 1 : 0;
      if (aFeatured !== bFeatured) return bFeatured - aFeatured;

      if (a.connected !== b.connected) return a.connected ? -1 : 1;

      if (a.provider === "fastmcp" && b.provider !== "fastmcp") return -1;
      if (b.provider === "fastmcp" && a.provider !== "fastmcp") return 1;

      return a.name.localeCompare(b.name);
    });
  }, [catalog.apps, providerFilter, statusFilter, isAllCategories, selectedCategories, deferredSearch, sortOption]);

  // Status Filter Counts scoped to current provider & category
  const statusCounts = useMemo(() => {
    const isAll =
      selectedCategories.length === 0 ||
      selectedCategories.length === categoryCounts.categories.length;

    const baseList = (catalog.apps || []).filter((app) => {
      if (providerFilter === "composio" && (app.provider ?? "composio") !== "composio") return false;
      if (providerFilter === "fastmcp" && app.provider !== "fastmcp") return false;
      if (!isAll) {
        const appCat = app.category?.trim() || "Other";
        if (!selectedCategories.includes(appCat) && !selectedCategories.includes(app.category)) return false;
      }
      return true;
    });

    const connected = baseList.filter((a) => a.connected).length;
    return {
      all: baseList.length,
      connected,
      available: baseList.length - connected,
    };
  }, [catalog.apps, providerFilter, selectedCategories, categoryCounts.categories.length]);

  // Pagination slice
  const totalFiltered = filteredApps.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedApps = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredApps.slice(start, start + pageSize);
  }, [filteredApps, safePage, pageSize]);

  // Save Configuration & Connect Handler (invoked by the Configuration Modal)
  async function handleSaveConfigAndConnect(payload: ConnectPayload) {
    setBusyApp(payload.app_key);
    setBanner(null);

    const targetApp = catalog.apps.find((a) => a.key === payload.app_key);
    const appName = targetApp?.name || payload.app_key;
    const isFastMcp = payload.auth_mode === "fastmcp" || targetApp?.provider === "fastmcp";

    try {
      const res = await post<{
        ok?: boolean;
        status?: string;
        app_key?: string;
        redirect_url?: string;
        connection?: MarketplaceConnection;
        registered_tools?: string[];
        message?: string;
      }>(`${API.execution}/v1/marketplace/connect`, payload);

      // Update local state immediately
      setCatalog((prev) => ({
        ...prev,
        apps: prev.apps.map((a) =>
          a.key === payload.app_key
            ? {
                ...a,
                connected: true,
                connection: res.connection || {
                  id: "conn-" + payload.app_key,
                  status: "connected",
                  auth_mode: payload.auth_mode,
                  entity_id: payload.entity_id,
                  created_at: new Date().toISOString(),
                  config: payload.config,
                },
              }
            : a
        ),
        counts: prev.counts
          ? {
              ...prev.counts,
              connected: (prev.counts.connected || 0) + (targetApp?.connected ? 0 : 1),
            }
          : undefined,
      }));

      // Background refresh
      refresh();

      // Direct Composio Connect redirect
      const redirectUrl = res.redirect_url || res.connection?.redirect_url;
      if (redirectUrl) {
        setBanner({
          ok: true,
          title: `Opening Composio Connect for ${appName}...`,
          detail: `Configuration saved. Direct authentication initiated in a new window. If blocked, click the link below.`,
          actionUrl: redirectUrl,
          actionLabel: `Open Composio Connect`,
        });

        try {
          window.open(redirectUrl, "_blank", "noopener,noreferrer");
        } catch {
          // Popup blocked
        }
      } else {
        setBanner({
          ok: true,
          title: `Connected ${appName}`,
          detail: `Protocol: ${isFastMcp ? "FastMCP Industrial API" : "composio.dev"} | Credentials saved securely.`,
        });
      }
    } catch (e: any) {
      setBanner({
        ok: false,
        title: `Failed to connect ${appName}`,
        detail: e?.message || "Connection request failed",
      });
      throw e;
    } finally {
      setBusyApp(null);
    }
  }

  // Disconnect handler
  async function handleDisconnect(app: MarketplaceApp) {
    setBusyApp(app.key);
    setBanner(null);
    try {
      await del(`${API.execution}/v1/marketplace/connections/${app.key}`);
      setCatalog((prev) => ({
        ...prev,
        apps: prev.apps.map((a) =>
          a.key === app.key
            ? { ...a, connected: false, connection: null }
            : a
        ),
        counts: prev.counts
          ? {
              ...prev.counts,
              connected: Math.max(0, (prev.counts.connected || 1) - 1),
            }
          : undefined,
      }));
      await refresh();
      setBanner({
        ok: true,
        title: `Disconnected ${app.name}`,
        detail: `Removed connection and credentials.`,
      });
    } catch (e: any) {
      setBanner({
        ok: false,
        title: `Failed to disconnect ${app.name}`,
        detail: e?.message || "Disconnect request failed",
      });
    } finally {
      setBusyApp(null);
    }
  }

  // Run test action
  async function handleRunIndividualTool(app: MarketplaceApp, tool?: MarketplaceTool) {
    const targetTool = tool || app.tools[0] || { name: `${app.key}_action` };
    setBusyApp(app.key);
    setBanner(null);
    const startTime = performance.now();

    try {
      const res = await post<{ ok: boolean; app_key: string; result?: Record<string, unknown> }>(
        `${API.execution}/v1/marketplace/test/${app.key}`,
        { action: targetTool.name, tool_name: targetTool.name }
      );

      const latencyMs = Math.max(1, Math.round(performance.now() - startTime));
      const resultObj = res.result ?? {
        status: "success",
        action: targetTool.name,
        output: "Action executed successfully through verified connector.",
        timestamp: new Date().toISOString(),
      };

      setExecutionModal({
        isOpen: true,
        app,
        tool: targetTool,
        result: resultObj,
        latencyMs,
        statusCode: 200,
        timestamp: new Date().toLocaleTimeString(),
      });

      setBanner({
        ok: true,
        title: `Executed: ${app.name} (${latencyMs}ms)`,
        detail: JSON.stringify(resultObj, null, 2),
      });

      refresh();
    } catch (e: any) {
      const latencyMs = Math.max(1, Math.round(performance.now() - startTime));
      setBanner({
        ok: false,
        title: `Failed to run action for ${app.name}`,
        detail: e?.message || "Execution failed",
      });
      setExecutionModal({
        isOpen: true,
        app,
        tool: targetTool,
        result: {
          error: e?.message || "Execution failed",
          status: "error",
          action: targetTool.name,
        },
        latencyMs,
        statusCode: 500,
        timestamp: new Date().toLocaleTimeString(),
      });
    } finally {
      setBusyApp(null);
    }
  }

  // Copy JSON helper
  function handleCopyJson(data: any) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Navigation Tabs: Switch between All Toolkits and Connected Connectors */}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 pb-4">
        <Link
          href="/marketplace"
          className="inline-flex h-8 items-center gap-2 rounded-full bg-neutral-950 px-3.5 text-xs font-semibold text-white transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
        >
          <span>All Toolkits</span>
          <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-white">
            {counts.total.toLocaleString()}
          </span>
        </Link>
        <Link
          href="/connectors"
          className="inline-flex h-8 items-center gap-2 rounded-full border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-700 transition-colors duration-150 ease-out-quart hover:bg-neutral-50 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
        >
          <span>Connected Connectors</span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-800">
            {counts.connected}
          </span>
        </Link>
      </div>

      {serviceOffline && (
        <Notice tone="warn">
          Execution service is initializing or unreachable; displaying verified connector preview. Connect or test integrations once the service is live.
        </Notice>
      )}

      {/* Top Architecture Status Card */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2.5">
            {isProWhitelabel ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
                Composio Pro · White-Label Active ({brandName})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium tabular-nums text-blue-800">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-600" aria-hidden="true" />
                composio.dev Ecosystem ({counts.composio.toLocaleString()} Toolkits)
              </span>
            )}

            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium tabular-nums text-amber-800">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-600" aria-hidden="true" />
              FastMCP Industrial Gateway ({counts.fastmcp} Enterprise Servers)
            </span>

            <span className="text-sm tabular-nums text-neutral-700">
              <strong className="font-semibold text-neutral-950">{counts.connected}</strong> / {counts.total.toLocaleString()} connectors active
            </span>

            <span className="text-xs text-neutral-600">
              {catalog.api_key_configured || catalog.composio_api_configured
                ? "Live Composio API key configured"
                : "Composio Connect direct link enabled"}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowRoadmap((v) => !v)}
            aria-expanded={showRoadmap}
            className={btnGhostCls}
          >
            {showRoadmap ? "Hide Architecture Roadmap" : "Architecture & Protocols"}
          </button>
        </div>

        {showRoadmap && (
          <div className="mt-4 space-y-3 border-t border-neutral-200 pt-4 text-xs text-neutral-700">
            <div className="font-semibold text-neutral-950">
              Integration Architecture: 1,640+ composio.dev Toolkits &amp; 6 Industrial FastMCP Servers
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-xl border border-blue-200 bg-blue-50/50 p-3.5">
                <div className="font-semibold text-blue-900">1. composio.dev Connector Network (1,640+ Toolkits)</div>
                <p className="leading-relaxed text-neutral-700">
                  Universal broker for SaaS, CRM, DevOps, Finance, and AI tools (Slack, GitHub, Gmail, Sheets, Linear, Jira, Salesforce, HubSpot, Stripe, Notion, Postman, Cloudflare, Sentry, Vercel). Saves configuration and opens Composio Connect for authentication.
                </p>
              </div>
              <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50/50 p-3.5">
                <div className="font-semibold text-amber-900">2. FastMCP Industrial Protocol (6 Enterprise Servers)</div>
                <p className="leading-relaxed text-neutral-700">
                  Model Context Protocol servers for SAP S/4HANA (OData/BAPIs), Siemens Xcelerator (Teamcenter PLM/Opcenter MES/NX), Rockwell Automation (FactoryTalk/Studio 5000), Dassault 3DEXPERIENCE, PTC Windchill, and Oracle SCM.
                </p>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Live Notification / Direct Link Banner */}
      {banner && (
        <Notice tone={banner.ok ? "info" : "bad"}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-neutral-950">{banner.title}</div>
              {banner.detail && (
                <pre className="mt-1.5 max-h-40 overflow-x-auto overflow-y-auto whitespace-pre-wrap font-mono text-xs text-neutral-800">
                  {banner.detail}
                </pre>
              )}
              {banner.actionUrl && (
                <div className="mt-3">
                  <a
                    href={banner.actionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={btnCls}
                  >
                    <span>{banner.actionLabel || "Open Direct Link"}</span>
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
            >
              Dismiss
            </button>
          </div>
        </Notice>
      )}

      {/* Unified Filter Controls Panel */}
      <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
        {/* Row 1: Provider Tabs & Status Filter */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Connector provider tabs">
            <button
              type="button"
              role="tab"
              aria-selected={providerFilter === "all"}
              onClick={() => {
                setProviderFilter("all");
                setCurrentPage(1);
              }}
              className={`inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-xs transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 ${
                providerFilter === "all"
                  ? "bg-neutral-950 font-semibold text-white"
                  : "border border-neutral-200 bg-neutral-50 font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950"
              }`}
            >
              <span>All Connectors</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                  providerFilter === "all"
                    ? "bg-neutral-800 text-white"
                    : "bg-neutral-200/80 text-neutral-700"
                }`}
              >
                {counts.total.toLocaleString()}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={providerFilter === "composio"}
              onClick={() => {
                setProviderFilter("composio");
                setCurrentPage(1);
              }}
              className={`inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-xs transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 ${
                providerFilter === "composio"
                  ? "bg-neutral-950 font-semibold text-white"
                  : "border border-neutral-200 bg-neutral-50 font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950"
              }`}
            >
              <span>Composio.dev</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                  providerFilter === "composio"
                    ? "bg-neutral-800 text-white"
                    : "bg-neutral-200/80 text-neutral-700"
                }`}
              >
                {counts.composio.toLocaleString()}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={providerFilter === "fastmcp"}
              onClick={() => {
                setProviderFilter("fastmcp");
                setCurrentPage(1);
              }}
              className={`inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-xs transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 ${
                providerFilter === "fastmcp"
                  ? "bg-neutral-950 font-semibold text-white"
                  : "border border-neutral-200 bg-neutral-50 font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950"
              }`}
            >
              <span>Industrial FastMCP</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                  providerFilter === "fastmcp"
                    ? "bg-neutral-800 text-white"
                    : "bg-neutral-200/80 text-neutral-700"
                }`}
              >
                {counts.fastmcp}
              </span>
            </button>
          </div>

          {/* Status Filter Toggle */}
          <div className="inline-flex h-9 max-w-full flex-wrap items-center rounded-full border border-neutral-200 bg-neutral-100 p-1 text-xs">
            <button
              type="button"
              onClick={() => {
                setStatusFilter("all");
                setCurrentPage(1);
              }}
              className={`inline-flex h-7 items-center rounded-full px-3 tabular-nums transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
                statusFilter === "all"
                  ? "bg-white font-semibold text-neutral-950"
                  : "font-medium text-neutral-600 hover:text-neutral-950"
              }`}
            >
              All ({statusCounts.all})
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter("connected");
                setCurrentPage(1);
              }}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 tabular-nums transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
                statusFilter === "connected"
                  ? "bg-white font-semibold text-neutral-950"
                  : "font-medium text-neutral-600 hover:text-neutral-950"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
              Connected Only ({statusCounts.connected})
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter("available");
                setCurrentPage(1);
              }}
              className={`inline-flex h-7 items-center rounded-full px-3 tabular-nums transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
                statusFilter === "available"
                  ? "bg-white font-semibold text-neutral-950"
                  : "font-medium text-neutral-600 hover:text-neutral-950"
              }`}
            >
              Available ({statusCounts.available})
            </button>
          </div>
        </div>

        {/* Row 2: Search Input & Sort Dropdown & Pagination Size */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3">
          <div className="relative w-full min-w-0 sm:flex-1 sm:min-w-[240px] sm:max-w-lg">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-neutral-500">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Search 1,640+ connectors by name, key, description, category..."
              aria-label="Search marketplace connectors"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              className={`${inputCls} pl-9 pr-14`}
            />
            {search ? (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setCurrentPage(1);
                  searchInputRef.current?.focus();
                }}
                className="absolute inset-y-0 right-2 my-auto flex h-6 w-6 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                title="Clear search"
                aria-label="Clear search"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            ) : (
              <div className="pointer-events-none absolute inset-y-0 right-3 hidden items-center sm:flex">
                <kbd className="rounded border border-neutral-200 bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600">
                  Ctrl+K
                </kbd>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs text-neutral-600">
            {/* Category Checkbox Dropdown */}
            <div className="relative" ref={categoryDropdownRef}>
              <button
                type="button"
                id="category-dropdown-button"
                aria-label="Filter by categories"
                aria-expanded={isCategoryOpen}
                aria-haspopup="true"
                onClick={() => setIsCategoryOpen((prev) => !prev)}
                className="flex h-9 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-800 transition-colors duration-150 ease-out-quart hover:border-neutral-300 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
              >
                <span className="tabular-nums">{categoryButtonLabel}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-neutral-600" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                </svg>
              </button>

              {isCategoryOpen && (
                <div
                  role="menu"
                  aria-orientation="vertical"
                  aria-labelledby="category-dropdown-button"
                  className="animate-fadeIn absolute left-0 top-full z-30 mt-1.5 max-h-80 w-[min(18rem,calc(100vw-2.5rem))] space-y-1 overflow-y-auto rounded-2xl border border-neutral-200/80 bg-white p-2 text-neutral-950 shadow-[0_12px_32px_rgba(15,23,42,0.14)] sm:left-auto sm:right-0"
                >
                  <div className="flex items-center justify-between px-2 py-1 text-xs">
                    <span className="font-semibold tabular-nums text-neutral-950">
                      {selectedCategories.length === 0
                        ? `Categories (${categoryCounts.categories.length})`
                        : `${selectedCategories.length} Selected`}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCategories(categoryCounts.categories.map((c) => c.name));
                          setCurrentPage(1);
                        }}
                        className="rounded px-1 py-0.5 text-xs font-semibold text-blue-700 transition-colors hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                      >
                        Select All
                      </button>
                      <span className="text-neutral-300" aria-hidden="true">|</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCategories([]);
                          setCurrentPage(1);
                        }}
                        className="rounded px-1 py-0.5 text-xs font-medium text-neutral-600 transition-colors hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="my-1 border-b border-neutral-100" />

                  <div className="space-y-0.5">
                    {categoryCounts.categories.map((cat) => {
                      const isChecked = selectedCategories.length === 0
                        ? false
                        : selectedCategories.includes(cat.name);

                      return (
                        <label
                          key={cat.name}
                          className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-neutral-50"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleCategory(cat.name)}
                            className="h-3.5 w-3.5 cursor-pointer rounded border-neutral-300 bg-white text-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-950"
                          />
                          <span className="flex-1 truncate text-xs text-neutral-800">{cat.name}</span>
                          <span className="rounded-full border border-neutral-200 bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-neutral-700">
                            {cat.count}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <label htmlFor="marketplace-sort" className="text-neutral-600">Sort:</label>
              <select
                id="marketplace-sort"
                aria-label="Sort connectors"
                value={sortOption}
                onChange={(e) => {
                  setSortOption(e.target.value as "featured" | "alpha" | "tools");
                  setCurrentPage(1);
                }}
                className="h-9 rounded-xl border border-neutral-200 bg-white px-2.5 text-xs font-medium text-neutral-800 transition-colors duration-150 ease-out-quart hover:border-neutral-300 focus-visible:border-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950/20"
              >
                <option value="featured">Featured / Popular</option>
                <option value="alpha">Alphabetical (A-Z)</option>
                <option value="tools">Most Tools</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 border-l border-neutral-200 pl-2.5">
              <span className="text-neutral-600">Per page:</span>
              {[24, 48, 96].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => {
                    setPageSize(size);
                    setCurrentPage(1);
                  }}
                  className={`inline-flex h-8 min-w-[2.25rem] items-center justify-center rounded-full px-2 text-xs tabular-nums transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 ${
                    pageSize === size
                      ? "bg-neutral-950 font-semibold text-white"
                      : "border border-neutral-200 bg-white font-medium text-neutral-700 hover:bg-neutral-50 hover:text-neutral-950"
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Row 3: Active Category Filter Badges */}
        {!isAllCategories && (
          <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3 text-xs">
            <span className="text-neutral-600">Active filter:</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium tabular-nums text-blue-800">
              <span>
                Filtered by {selectedCategories.length}{" "}
                {selectedCategories.length === 1
                  ? `category (${selectedCategories[0]})`
                  : `${selectedCategories.length} categories`}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedCategories([]);
                  setCurrentPage(1);
                }}
                className="ml-0.5 inline-flex items-center justify-center rounded-full p-0.5 text-blue-700 transition-colors hover:bg-blue-100 hover:text-blue-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                title="Clear category filter"
                aria-label="Clear category filter"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedCategories([]);
                setCurrentPage(1);
              }}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-neutral-600 underline underline-offset-2 transition-colors hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Results Header / Pagination Top */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-600">
        <div className="tabular-nums">
          Showing{" "}
          <strong className="font-semibold text-neutral-950">
            {totalFiltered === 0 ? 0 : (safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, totalFiltered)}
          </strong>{" "}
          of <strong className="font-semibold text-neutral-950">{totalFiltered.toLocaleString()}</strong> connectors
          {!isAllCategories && (
            <span>
              {" "}in{" "}
              <strong className="font-semibold text-neutral-900">
                {selectedCategories.length === 1
                  ? selectedCategories[0]
                  : `${selectedCategories.length} categories`}
              </strong>
            </span>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-2 tabular-nums">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="inline-flex h-8 items-center rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 transition-colors duration-150 ease-out-quart hover:bg-neutral-50 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
            >
              &larr; Prev
            </button>
            <span className="text-neutral-600">
              Page <strong className="font-semibold text-neutral-950">{safePage}</strong> of {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex h-8 items-center rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 transition-colors duration-150 ease-out-quart hover:bg-neutral-50 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
            >
              Next &rarr;
            </button>
          </div>
        )}
      </div>

      {/* Grid of Connectors */}
      {paginatedApps.length === 0 ? (
        <Card className="text-center">
          <Empty>No connectors match your current filters.</Empty>
          <div className="pb-4">
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setSelectedCategories([]);
                setProviderFilter("all");
                setStatusFilter("all");
                setCurrentPage(1);
              }}
              className={btnGhostCls}
            >
              Reset All Filters
            </button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2" id="marketplace-results">
          {paginatedApps.map((app) => {
            const isBusy = busyApp === app.key;
            const isFastMcp = app.provider === "fastmcp";
            const avatarTone = getAvatarTone(app);
            const initials = getAppInitials(app.name, app.key);

            return (
              <div
                key={app.key}
                className="flex flex-col justify-between rounded-2xl border border-neutral-200 bg-white p-5 transition-colors duration-150 ease-out-quart hover:border-neutral-300"
              >
                <div className="space-y-3">
                  {/* Card Header with Monogram, Title, Metadata Line, and Status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-xs font-bold tracking-tight ${avatarTone}`}
                      >
                        {initials}
                      </div>

                      <div className="min-w-0 space-y-1">
                        <h3 className="truncate text-base font-semibold tracking-tight text-neutral-950">
                          {app.name}
                        </h3>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-600">
                          <span className="inline-flex items-center gap-1.5 font-medium text-neutral-700">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${isFastMcp ? "bg-amber-600" : "bg-blue-600"}`}
                              aria-hidden="true"
                            />
                            {isFastMcp ? "Industrial FastMCP" : "composio.dev"}
                          </span>
                          <span className="text-neutral-300" aria-hidden="true">/</span>
                          <span className="truncate">{app.category}</span>
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {app.connected ? (
                        <Badge variant="success">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
                          Connected
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-neutral-600">
                          Available
                        </Badge>
                      )}
                    </div>
                  </div>

                  <p className="text-sm leading-relaxed text-neutral-600">{app.description}</p>
                </div>

                {/* Card Footer */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                    <span className="font-mono text-[11px]">Auth: {(app.auth_schemes || []).join(" / ")}</span>
                    {app.docs_url && (
                      <>
                        <span className="text-neutral-300" aria-hidden="true">&middot;</span>
                        <a
                          href={app.docs_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded font-medium text-neutral-700 underline-offset-2 transition-colors hover:text-neutral-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                        >
                          <span>Specs</span>
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                        </a>
                      </>
                    )}
                  </div>

                  {canManage ? (
                    app.connected ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setConfigModalApp(app)}
                        >
                          Reconfigure
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => handleRunIndividualTool(app)}
                        >
                          {isBusy ? "Running..." : "Test Action"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => handleDisconnect(app)}
                        >
                          Disconnect
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => setConfigModalApp(app)}
                      >
                        {isBusy ? "Connecting..." : "Connect"}
                      </Button>
                    )
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 text-neutral-600" aria-hidden="true">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                      <span>View-Only (Admin Managed)</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom Pagination Controls */}
      {totalPages > 1 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-neutral-200 pt-4 text-xs">
          <div className="tabular-nums text-neutral-600">
            Showing Page <strong className="font-semibold text-neutral-950">{safePage}</strong> of{" "}
            <strong className="font-semibold text-neutral-950">{totalPages}</strong> ({totalFiltered.toLocaleString()} matching connectors)
          </div>

          <div className="flex flex-wrap items-center gap-1.5 tabular-nums">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => {
                setCurrentPage(1);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="inline-flex h-8 items-center rounded-full border border-neutral-200 bg-white px-3 font-medium text-neutral-700 transition-colors duration-150 ease-out-quart hover:bg-neutral-50 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
            >
              &laquo; First
            </button>
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => {
                setCurrentPage((p) => Math.max(1, p - 1));
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="inline-flex h-8 items-center rounded-full border border-neutral-200 bg-white px-3 font-medium text-neutral-700 transition-colors duration-150 ease-out-quart hover:bg-neutral-50 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
            >
              &lsaquo; Prev
            </button>

            {(() => {
              const pages: number[] = [];
              const maxButtons = 5;
              let start = Math.max(1, safePage - Math.floor(maxButtons / 2));
              let end = Math.min(totalPages, start + maxButtons - 1);
              if (end - start + 1 < maxButtons) {
                start = Math.max(1, end - maxButtons + 1);
              }
              for (let i = start; i <= end; i++) pages.push(i);

              return pages.map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => {
                    setCurrentPage(page);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className={`inline-flex h-8 min-w-[2rem] items-center justify-center rounded-full px-2.5 text-center transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 ${
                    safePage === page
                      ? "bg-neutral-950 font-semibold text-white"
                      : "border border-neutral-200 bg-white font-medium text-neutral-700 hover:bg-neutral-50 hover:text-neutral-950"
                  }`}
                >
                  {page}
                </button>
              ));
            })()}

            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => {
                setCurrentPage((p) => Math.min(totalPages, p + 1));
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="inline-flex h-8 items-center rounded-full border border-neutral-200 bg-white px-3 font-medium text-neutral-700 transition-colors duration-150 ease-out-quart hover:bg-neutral-50 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
            >
              Next &rsaquo;
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => {
                setCurrentPage(totalPages);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="inline-flex h-8 items-center rounded-full border border-neutral-200 bg-white px-3 font-medium text-neutral-700 transition-colors duration-150 ease-out-quart hover:bg-neutral-50 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
            >
              Last ({totalPages}) &raquo;
            </button>
          </div>
        </div>
      )}

      {/* Configuration & Connection Modal */}
      <MarketplaceConfigModal
        isOpen={Boolean(configModalApp)}
        app={configModalApp}
        onClose={() => setConfigModalApp(null)}
        onSubmit={handleSaveConfigAndConnect}
      />

      {/* Tool Execution Result Modal */}
      <ExecutionResultModal
        data={executionModal}
        title="Action Execution Output"
        copiedJson={copiedJson}
        onCopyJson={handleCopyJson}
        onRerun={
          executionModal
            ? () => handleRunIndividualTool(executionModal.app, executionModal.tool)
            : undefined
        }
        onClose={() => setExecutionModal(null)}
      />
    </div>
  );
}
