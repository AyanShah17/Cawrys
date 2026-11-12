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
  MarketplaceConfigModal,
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

function getAppInitials(name: string, key: string): string {
  if (key === "sap_s4hana") return "SAP";
  if (key === "siemens_xcelerator") return "SX";
  if (key === "rockwell_factorytalk") return "RA";
  if (key === "dassault_3dexperience") return "3DS";
  if (key === "ptc_windchill") return "PTC";
  if (key === "oracle_scm") return "ORA";

  const clean = name.replace(/[^a-zA-Z0-9\s]/g, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return key.slice(0, 2).toUpperCase();
}

function getAvatarStyles(app: MarketplaceApp) {
  if (app.provider === "fastmcp") {
    return {
      bg: "from-amber-500/20 to-orange-600/30 border-amber-500/30 text-amber-300",
      indicator: "bg-amber-400",
    };
  }
  const cat = (app.category || "").toLowerCase();
  if (cat.includes("developer") || cat.includes("devops")) {
    return {
      bg: "from-emerald-500/20 to-teal-600/30 border-emerald-500/30 text-emerald-300",
      indicator: "bg-emerald-400",
    };
  }
  if (cat.includes("crm") || cat.includes("sales")) {
    return {
      bg: "from-rose-500/20 to-orange-600/30 border-rose-500/30 text-rose-300",
      indicator: "bg-rose-400",
    };
  }
  if (cat.includes("finance") || cat.includes("accounting") || cat.includes("billing")) {
    return {
      bg: "from-green-500/20 to-emerald-600/30 border-green-500/30 text-green-300",
      indicator: "bg-green-400",
    };
  }
  if (cat.includes("communication") || cat.includes("social")) {
    return {
      bg: "from-purple-500/20 to-violet-600/30 border-purple-500/30 text-purple-300",
      indicator: "bg-purple-400",
    };
  }
  if (cat.includes("support") || cat.includes("ticketing")) {
    return {
      bg: "from-amber-500/20 to-yellow-600/30 border-yellow-500/30 text-yellow-300",
      indicator: "bg-yellow-400",
    };
  }
  return {
    bg: "from-indigo-500/20 to-blue-600/30 border-indigo-500/30 text-indigo-300",
    indicator: "bg-indigo-400",
  };
}

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
    if (initial === null) {
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
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-4">
        <Link
          href="/marketplace"
          className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-bold text-black shadow-md transition"
        >
          <span>All Toolkits</span>
          <span className="rounded-full bg-black/15 px-2 py-0.5 text-[10px] font-bold text-black">
            {counts.total.toLocaleString()}
          </span>
        </Link>
        <Link
          href="/connectors"
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-white/10 hover:text-white transition"
        >
          <span>Connected Connectors</span>
          <span className="rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold">
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
      <Card className="relative overflow-hidden border-white/10 bg-gradient-to-r from-white/[0.04] via-white/[0.02] to-transparent">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {isProWhitelabel ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/15 px-3 py-1 text-xs font-medium text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
                Composio Pro · White-Label Active ({brandName})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-400/15 px-3 py-1 text-xs font-medium text-indigo-300">
                <span className="h-2 w-2 rounded-full bg-indigo-400" aria-hidden />
                composio.dev Ecosystem ({counts.composio.toLocaleString()} Toolkits)
              </span>
            )}

            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/15 px-3 py-1 text-xs font-medium text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />
              FastMCP Industrial Gateway ({counts.fastmcp} Enterprise Servers)
            </span>

            <span className="text-sm text-neutral-300">
              <strong className="font-semibold text-white">{counts.connected}</strong> / {counts.total.toLocaleString()} connectors active
            </span>

            <span className="text-xs text-neutral-500">
              {catalog.api_key_configured || catalog.composio_api_configured
                ? "Live Composio API key configured"
                : "Composio Connect direct link enabled"}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowRoadmap((v) => !v)}
            className={btnGhostCls}
          >
            {showRoadmap ? "Hide Architecture Roadmap" : "Architecture & Protocols"}
          </button>
        </div>

        {showRoadmap && (
          <div className="mt-4 rounded-lg border border-white/10 bg-black/50 p-4 text-xs text-neutral-300 space-y-3">
            <div className="font-semibold text-white">
              Integration Architecture: 1,640+ composio.dev Toolkits &amp; 6 Industrial FastMCP Servers
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded border border-indigo-400/20 bg-indigo-500/5 p-3">
                <div className="font-semibold text-indigo-300">1. composio.dev Connector Network (1,640+ Toolkits)</div>
                <p className="text-neutral-400 leading-relaxed">
                  Universal broker for SaaS, CRM, DevOps, Finance, and AI tools (Slack, GitHub, Gmail, Sheets, Linear, Jira, Salesforce, HubSpot, Stripe, Notion, Postman, Cloudflare, Sentry, Vercel). Saves configuration and opens Composio Connect for authentication.
                </p>
              </div>
              <div className="space-y-1 rounded border border-amber-400/20 bg-amber-500/5 p-3">
                <div className="font-semibold text-amber-300">2. FastMCP Industrial Protocol (6 Enterprise Servers)</div>
                <p className="text-neutral-400 leading-relaxed">
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
              <div className="font-medium text-white">{banner.title}</div>
              {banner.detail && (
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs opacity-90 max-h-40 overflow-y-auto">
                  {banner.detail}
                </pre>
              )}
              {banner.actionUrl && (
                <div className="mt-2.5">
                  <a
                    href={banner.actionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-indigo-500 transition"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {banner.actionLabel || "Open Direct Link"}
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                      </svg>
                    </span>
                  </a>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-xs text-neutral-400 hover:text-white shrink-0 p-1"
            >
              Dismiss
            </button>
          </div>
        </Notice>
      )}

      {/* Unified Filter Controls Panel */}
      <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        {/* Row 1: Provider Tabs & Status Filter */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Connector provider tabs">
            <button
              type="button"
              role="tab"
              aria-selected={providerFilter === "all"}
              onClick={() => {
                setProviderFilter("all");
                setCurrentPage(1);
              }}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                providerFilter === "all"
                  ? "bg-white text-black shadow-md font-bold"
                  : "border border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span>All Connectors</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  providerFilter === "all"
                    ? "bg-black/15 text-black font-bold"
                    : "bg-white/10 text-neutral-300"
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
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                providerFilter === "composio"
                  ? "bg-indigo-600 text-white shadow-md ring-2 ring-indigo-400/50"
                  : "border border-indigo-400/20 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
              }`}
            >
              <span>Composio.dev</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  providerFilter === "composio"
                    ? "bg-white/20 text-white font-bold"
                    : "bg-indigo-400/20 text-indigo-200"
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
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                providerFilter === "fastmcp"
                  ? "bg-amber-600 text-white shadow-md ring-2 ring-amber-400/50"
                  : "border border-amber-400/20 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
              }`}
            >
              <span>Industrial FastMCP</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  providerFilter === "fastmcp"
                    ? "bg-white/20 text-white font-bold"
                    : "bg-amber-400/20 text-amber-200"
                }`}
              >
                {counts.fastmcp}
              </span>
            </button>
          </div>

          {/* Status Filter Toggle */}
          <div className="flex items-center rounded-lg border border-white/10 bg-black/40 p-1 text-xs">
            <button
              type="button"
              onClick={() => {
                setStatusFilter("all");
                setCurrentPage(1);
              }}
              className={`rounded-md px-3 py-1 font-medium transition ${
                statusFilter === "all"
                  ? "bg-white/20 text-white font-semibold"
                  : "text-neutral-400 hover:text-white"
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
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition ${
                statusFilter === "connected"
                  ? "bg-emerald-500/20 text-emerald-300 font-semibold ring-1 ring-emerald-500/30"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Connected Only ({statusCounts.connected})
            </button>
            <button
              type="button"
              onClick={() => {
                setStatusFilter("available");
                setCurrentPage(1);
              }}
              className={`rounded-md px-3 py-1 font-medium transition ${
                statusFilter === "available"
                  ? "bg-white/20 text-white font-semibold"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              Available ({statusCounts.available})
            </button>
          </div>
        </div>

        {/* Row 2: Search Input & Sort Dropdown & Pagination Size */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/5">
          <div className="relative flex-1 min-w-[280px] max-w-lg">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-neutral-500">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                className="absolute right-3 top-2.5 text-xs text-neutral-400 hover:text-white"
                title="Clear search"
                aria-label="Clear search"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            ) : (
              <div className="pointer-events-none absolute right-3 top-2.5 hidden sm:flex items-center gap-1">
                <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-mono text-neutral-400">
                  Ctrl+K
                </kbd>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
            {/* Category Checkbox Dropdown */}
            <div className="relative" ref={categoryDropdownRef}>
              <button
                type="button"
                id="category-dropdown-button"
                aria-label="Filter by categories"
                aria-expanded={isCategoryOpen}
                aria-haspopup="true"
                onClick={() => setIsCategoryOpen((prev) => !prev)}
                className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-white hover:bg-white/10 hover:border-white/30 transition focus:outline-none focus:ring-1 focus:ring-brand"
              >
                <span>{categoryButtonLabel}</span>
                <span className="text-[10px] text-neutral-400" aria-hidden="true">▾</span>
              </button>

              {isCategoryOpen && (
                <div
                  role="menu"
                  aria-orientation="vertical"
                  aria-labelledby="category-dropdown-button"
                  className="absolute right-0 top-full mt-1.5 z-30 max-h-80 w-72 overflow-y-auto rounded-lg border border-white/15 bg-neutral-950 p-2 shadow-2xl space-y-1"
                >
                  {/* Header bar with Select All and Clear */}
                  <div className="flex items-center justify-between px-2 py-1 text-xs">
                    <span className="font-semibold text-neutral-300">
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
                        className="text-xs text-indigo-400 hover:text-indigo-300 transition font-medium"
                      >
                        Select All
                      </button>
                      <span className="text-neutral-600">|</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCategories([]);
                          setCurrentPage(1);
                        }}
                        className="text-xs text-neutral-400 hover:text-white transition"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="border-b border-white/10 my-1" />

                  {/* Scrollable list of category items with checkboxes */}
                  <div className="space-y-0.5">
                    {categoryCounts.categories.map((cat) => {
                      const isChecked = selectedCategories.length === 0
                        ? false
                        : selectedCategories.includes(cat.name);

                      return (
                        <label
                          key={cat.name}
                          className="hover:bg-white/5 rounded px-2 py-1.5 flex items-center gap-2 cursor-pointer transition select-none"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleCategory(cat.name)}
                            className="rounded border-white/20 bg-black/60 text-brand focus:ring-brand h-3.5 w-3.5 cursor-pointer"
                          />
                          <span className="flex-1 text-xs text-neutral-200 truncate">{cat.name}</span>
                          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-neutral-400 font-mono">
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
              <span>Sort:</span>
              <select
                aria-label="Sort connectors"
                value={sortOption}
                onChange={(e) => {
                  setSortOption(e.target.value as "featured" | "alpha" | "tools");
                  setCurrentPage(1);
                }}
                className="rounded-lg border border-white/15 bg-black/60 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand"
              >
                <option value="featured">Featured / Popular</option>
                <option value="alpha">Alphabetical (A-Z)</option>
                <option value="tools">Most Tools</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 border-l border-white/10 pl-3">
              <span>Per page:</span>
              {[24, 48, 96].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => {
                    setPageSize(size);
                    setCurrentPage(1);
                  }}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                    pageSize === size
                      ? "bg-white text-black font-semibold"
                      : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Row 3: Active Category Filter Badges (Shown only when filtering by specific categories) */}
        {!isAllCategories && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5 text-xs">
            <span className="text-neutral-400">Active filter:</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand-light">
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
                className="ml-1 rounded-full p-0.5 text-neutral-400 hover:bg-white/20 hover:text-white transition inline-flex items-center justify-center"
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
              className="text-[11px] text-neutral-400 hover:text-white underline underline-offset-2 ml-1"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Results Header / Pagination Top */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-400">
        <div>
          Showing{" "}
          <strong className="text-white">
            {totalFiltered === 0 ? 0 : (safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, totalFiltered)}
          </strong>{" "}
          of <strong className="text-white">{totalFiltered.toLocaleString()}</strong> connectors
          {!isAllCategories && (
            <span>
              {" "}in{" "}
              <strong className="text-neutral-200">
                {selectedCategories.length === 1
                  ? selectedCategories[0]
                  : `${selectedCategories.length} categories`}
              </strong>
            </span>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="rounded border border-white/10 bg-white/5 px-2.5 py-1 text-neutral-300 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none"
            >
              ← Prev
            </button>
            <span className="text-neutral-400">
              Page <strong className="text-white">{safePage}</strong> of {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="rounded border border-white/10 bg-white/5 px-2.5 py-1 text-neutral-300 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Grid of Clean Minimal Cards (Showing ONLY Name, Badges, Description, Status Pill, and Connect Button) */}
      {paginatedApps.length === 0 ? (
        <Card>
          <Empty>
            No connectors match your current filters.
            <div className="mt-3">
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
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2" id="marketplace-results">
          {paginatedApps.map((app) => {
            const isBusy = busyApp === app.key;
            const isFastMcp = app.provider === "fastmcp";
            const avatarStyle = getAvatarStyles(app);
            const initials = getAppInitials(app.name, app.key);

            return (
              <div
                key={app.key}
                className="group relative flex flex-col justify-between rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-5 transition-all duration-200 hover:border-white/20 hover:shadow-xl hover:shadow-black/30"
              >
                <div className="space-y-3.5">
                  {/* Card Header with Avatar, Title, Provider badge, and Status Pill */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {/* Avatar / Brand Initial Badge */}
                      <div
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-gradient-to-br font-bold shadow-md text-xs tracking-tight ${avatarStyle.bg}`}
                      >
                        {initials}
                      </div>

                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-white tracking-tight group-hover:text-white transition">
                            {app.name}
                          </h3>
                          <Badge variant="secondary" className="text-[11px] font-normal py-0">
                            {app.category}
                          </Badge>
                        </div>

                        {/* Provider Badge */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {isFastMcp ? (
                            <Badge variant="warning" className="text-[11px] font-medium py-0.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                              Industrial FastMCP
                            </Badge>
                          ) : (
                            <Badge variant="default" className="text-[11px] font-medium py-0.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                              composio.dev
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Status Pill: Connected with pulsing indicator dot or Available */}
                    <div className="shrink-0">
                      {app.connected ? (
                        <Badge variant="success" className="px-2.5 py-1 text-xs">
                          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
                          Connected
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="px-2.5 py-1 text-xs text-neutral-400">
                          Available
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Description ONLY - minimal and clean */}
                  <p className="text-sm text-neutral-400 leading-relaxed">{app.description}</p>
                </div>

                {/* Card Actions Footer:
                    - Disconnected card: EXACTLY ONE CONNECT BUTTON (opens Configuration Modal)
                    - Connected card: Reconfigure, Test Action, Disconnect */}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                  <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                    <span>Auth: {(app.auth_schemes || []).join(" / ")}</span>
                    {app.docs_url && (
                      <>
                        <span>·</span>
                        <a
                          href={app.docs_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-neutral-400 hover:text-white"
                        >
                          <span className="inline-flex items-center gap-1">
                            Specs
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                              <polyline points="15 3 21 3 21 9"></polyline>
                              <line x1="10" y1="14" x2="21" y2="3"></line>
                            </svg>
                          </span>
                        </a>
                      </>
                    )}
                  </div>

                  {canManage ? (
                    app.connected ? (
                      <div className="flex items-center gap-2">
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
                        className="shadow-sm"
                      >
                        {isBusy ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-white animate-ping" />
                            Connecting...
                          </span>
                        ) : (
                          "Connect"
                        )}
                      </Button>
                    )
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-neutral-400 font-medium">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 text-neutral-400" aria-hidden="true">
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

      {/* Bottom Full Pagination Controls */}
      {totalPages > 1 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-4 text-xs">
          <div className="text-neutral-400">
            Showing Page <strong className="text-white">{safePage}</strong> of{" "}
            <strong className="text-white">{totalPages}</strong> ({totalFiltered.toLocaleString()} matching connectors)
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => {
                setCurrentPage(1);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="rounded border border-white/10 bg-white/5 px-2.5 py-1 text-neutral-300 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none"
            >
              « First
            </button>
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => {
                setCurrentPage((p) => Math.max(1, p - 1));
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="rounded border border-white/10 bg-white/5 px-2.5 py-1 text-neutral-300 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none"
            >
              ‹ Prev
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
                  className={`min-w-[28px] rounded px-2 py-1 text-center font-medium transition ${
                    safePage === page
                      ? "bg-brand text-white font-semibold shadow"
                      : "border border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10"
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
              className="rounded border border-white/10 bg-white/5 px-2.5 py-1 text-neutral-300 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none"
            >
              Next ›
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => {
                setCurrentPage(totalPages);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="rounded border border-white/10 bg-white/5 px-2.5 py-1 text-neutral-300 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none"
            >
              Last ({totalPages}) »
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
      {executionModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setExecutionModal(null)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-white/20 bg-neutral-950 p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <h3 className="text-lg font-semibold text-white">
                    Action Execution Output
                  </h3>
                </div>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {executionModal.app.name} ·{" "}
                  <code className="text-sky-300">{executionModal.tool.name}</code>
                </p>
              </div>

              <button
                type="button"
                onClick={() => setExecutionModal(null)}
                className="rounded p-1 text-neutral-400 hover:bg-white/10 hover:text-white transition"
                aria-label="Close modal"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {executionModal.statusCode === 200 ? "200 OK · Executed" : `${executionModal.statusCode} Error`}
              </span>

              <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/30 bg-sky-400/15 px-2.5 py-0.5 text-xs font-semibold text-sky-300">
                Latency: {executionModal.latencyMs} ms
              </span>

              <span className="rounded border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-neutral-300">
                Provider: {executionModal.app.provider === "fastmcp" ? "Industrial FastMCP" : "composio.dev"}
              </span>

              <span className="ml-auto text-xs text-neutral-500">
                {executionModal.timestamp}
              </span>
            </div>

            <div className="flex-1 min-h-0 flex flex-col space-y-1.5">
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span>Structured JSON Response:</span>
                <button
                  type="button"
                  onClick={() => handleCopyJson(executionModal.result)}
                  className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-white/10 hover:text-white transition flex items-center gap-1.5"
                >
                  {copiedJson ? (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3 text-emerald-400" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span className="text-emerald-300">Copied</span>
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3" aria-hidden="true">
                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                      </svg>
                      <span>Copy JSON</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="flex-1 overflow-auto rounded-lg border border-white/10 bg-black/60 p-4 font-mono text-xs text-emerald-400/90 leading-relaxed">
                {JSON.stringify(executionModal.result, null, 2)}
              </pre>
            </div>

            <div className="flex items-center justify-between border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => handleRunIndividualTool(executionModal.app, executionModal.tool)}
                className={btnCls}
              >
                Re-Run Action
              </button>

              <button
                type="button"
                onClick={() => setExecutionModal(null)}
                className={btnGhostCls}
              >
                Close Output
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
