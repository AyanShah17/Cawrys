// apps/web/components/top-nav.tsx
"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Brand } from "@/lib/brand";
import { useAppMode } from "@/lib/mode-context";

interface TopNavProps {
  brand: Brand;
  email: string;
  role: string;
}

export function TopNav({ brand, email, role }: TopNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, toggleMode } = useAppMode();
  const [profileOpen, setProfileOpen] = useState(false);
  const [dateSelected, setDateSelected] = useState<string>("Today, Dec 7");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [persistenceMode, setPersistenceMode] = useState<"local" | "neon">("local");
  const [persistenceLoading, setPersistenceLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

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
        router.refresh();
      }
    } catch (err) {
      console.error("Failed to toggle persistence mode:", err);
    } finally {
      setPersistenceLoading(false);
    }
  }

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotificationsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const userInitial = (email?.[0] || "U").toUpperCase();
  const userName = email?.split("@")[0] || "User";
  const isEngineer = role === "engineer";

  const aiTabs = [
    { href: "/chat", label: "Agent Chat" },
    { href: "/connectors", label: "Connectors" },
    ...(!isEngineer
      ? [
          { href: "/marketplace", label: "Marketplace" },
          { href: "/settings", label: "Settings" },
        ]
      : []),
  ];

  const dashboardTabs = [
    { href: "/", label: "Overview" },
    { href: "/documents", label: "Documents" },
    ...(!isEngineer
      ? [
          { href: "/playbooks", label: "Execution" },
          { href: "/approvals", label: "Approvals" },
          { href: "/audit", label: "Audit" },
        ]
      : []),
    ...(role === "admin" ? [{ href: "/team", label: "Team" }] : []),
  ];

  const currentTabs = mode === "ai" ? aiTabs : dashboardTabs;

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <header className="sticky top-3 z-50 px-4 md:px-8 max-w-7xl mx-auto w-full">
      <div className="flex items-center justify-between gap-3">
        {/* Left: TIX Black Circle Brand Mark */}
        <Link
          href="/"
          className="flex items-center gap-2 group transition-transform active:scale-95 shrink-0"
          title={`${brand.name} - Home`}
        >
          <div className="h-10 w-10 rounded-full bg-neutral-950 text-white flex items-center justify-center font-black tracking-widest text-xs shadow-md border border-neutral-800 transition-all duration-200 group-hover:scale-105">
            TIX
          </div>
          <span className="hidden sm:inline-block font-bold tracking-tight text-neutral-900 text-sm">
            {brand.name}
          </span>
        </Link>

        {/* Center: Floating Top Black Navigation Pill Container */}
        <div className="bg-neutral-950 text-white rounded-full p-1.5 flex items-center gap-1 shadow-xl border border-neutral-800 overflow-x-auto no-scrollbar max-w-full">
          {/* Single UI Mode Switch Button */}
          <button
            type="button"
            onClick={toggleMode}
            title={mode === "ai" ? "Switch to Dashboard Mode" : "Switch to AI Mode"}
            aria-label={mode === "ai" ? "Switch to Dashboard Mode" : "Switch to AI Mode"}
            className="rounded-full px-3.5 py-1.5 text-xs font-semibold bg-neutral-800/90 hover:bg-neutral-700 text-white border border-neutral-700/80 transition-all flex items-center gap-1.5 shrink-0 select-none"
          >
            {mode === "ai" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 shrink-0">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 shrink-0">
                <rect x="3" y="3" width="7" height="9" />
                <rect x="14" y="3" width="7" height="5" />
                <rect x="14" y="12" width="7" height="9" />
                <rect x="3" y="16" width="7" height="5" />
              </svg>
            )}
            <span>{mode === "ai" ? "AI Mode" : "Dashboard"}</span>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 opacity-70 shrink-0" aria-hidden="true">
              <path d="M7 16V4M7 4L3 8M7 4l4 4" />
              <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>

          {/* Persistence Mode Toggle Button */}
          <button
            type="button"
            onClick={togglePersistence}
            disabled={persistenceLoading}
            title={`Active: ${persistenceMode === "neon" ? "Neon" : "Local"}. Click to toggle persistence mode`}
            className="rounded-full px-3 py-1.5 text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-700/80 transition-all flex items-center gap-1.5 shrink-0 select-none disabled:opacity-50"
          >
            {persistenceMode === "neon" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-cyan-400 shrink-0">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-emerald-400 shrink-0">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
              </svg>
            )}
            <span>Persistence: {persistenceMode === "neon" ? "Neon" : "Local"}</span>
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${persistenceMode === "neon" ? "bg-cyan-400" : "bg-emerald-400"}`} />
          </button>

          {/* Vertical Divider */}
          <div className="h-4 w-[1px] bg-neutral-800 mx-1 shrink-0" />

          {/* Contextual Route Pill Tabs */}
          <nav className="flex items-center gap-1 shrink-0">
            {currentTabs.map((tab) => {
              const active = isActive(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`rounded-full px-3.5 py-1.5 text-xs transition-all duration-150 shrink-0 whitespace-nowrap ${
                    active
                      ? "bg-white text-black font-semibold shadow-sm"
                      : "text-neutral-400 hover:text-white hover:bg-neutral-900"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: Date Selector Pill, Notifications, User Avatar */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Date Selector Badge Button */}
          <button
            type="button"
            onClick={() => {
              const next = dateSelected === "Today, Dec 7" ? "Last 14 Days" : "Today, Dec 7";
              setDateSelected(next);
            }}
            className="hidden md:flex items-center gap-1.5 rounded-full bg-white border border-neutral-200/80 px-3.5 py-1.5 text-xs font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 hover:border-neutral-300 transition-all select-none"
            title="Filter operational timeframe"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-neutral-500">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>{dateSelected}</span>
          </button>

          {/* Notifications Icon Button */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              className="h-9 w-9 rounded-full bg-white border border-neutral-200/80 shadow-sm flex items-center justify-center text-neutral-700 hover:text-neutral-900 hover:bg-neutral-50 hover:border-neutral-300 transition-all relative"
              title="System Notifications"
              aria-label="System Notifications"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" />
            </button>

            {/* Notifications Popover */}
            {notificationsOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-neutral-200/80 bg-white p-3 text-xs text-neutral-800 shadow-xl z-50">
                <div className="flex items-center justify-between border-b border-neutral-100 pb-2 mb-2 font-semibold">
                  <span>System Activity</span>
                  <span className="text-[10px] text-emerald-600 font-medium">All normal</span>
                </div>
                <div className="space-y-2">
                  <div className="p-2 rounded-xl bg-neutral-50 border border-neutral-100">
                    <div className="font-medium text-neutral-900">Line 2 Velocity Peak</div>
                    <div className="text-[11px] text-neutral-500 mt-0.5">Spindle rotation reached 89 units at 4:00 AM.</div>
                  </div>
                  <div className="p-2 rounded-xl bg-neutral-50 border border-neutral-100">
                    <div className="font-medium text-neutral-900">Telemetry Sync</div>
                    <div className="text-[11px] text-neutral-500 mt-0.5">SAP & Siemens FastMCP connected.</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* User Profile Circular Avatar & Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setProfileOpen(!profileOpen)}
              className="h-9 w-9 rounded-full bg-neutral-950 border border-neutral-800 text-white flex items-center justify-center font-bold text-xs shadow-sm hover:scale-105 active:scale-95 transition-all"
              title={`${email} (${role})`}
              aria-label="User profile menu"
            >
              {userInitial}
            </button>

            {/* Profile Dropdown */}
            {profileOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-neutral-200/80 bg-white p-3.5 text-xs text-neutral-900 shadow-xl z-50 animate-fadeIn">
                <div className="flex items-center gap-2.5 pb-3 border-b border-neutral-100">
                  <div className="h-9 w-9 rounded-full bg-neutral-950 text-white flex items-center justify-center font-bold text-xs">
                    {userInitial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-neutral-900 truncate" title={email}>
                      {userName}
                    </div>
                    <div className="text-[11px] text-neutral-500 truncate" title={email}>
                      {email}
                    </div>
                  </div>
                </div>

                <div className="py-2.5 flex items-center justify-between">
                  <span className="text-neutral-500 text-[11px]">Role</span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 capitalize border border-neutral-200">
                    {role}
                  </span>
                </div>

                <div className="pt-2 border-t border-neutral-100">
                  <button
                    type="button"
                    onClick={signOut}
                    className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200/80 text-neutral-800 py-2 text-xs font-medium transition-colors"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
