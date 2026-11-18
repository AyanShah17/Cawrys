// apps/web/components/top-nav.tsx
"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Brand } from "@/lib/brand";
import { useAppMode } from "@/lib/mode-context";

interface TopNavProps {
  brand: Brand;
  email: string;
  role: string;
}

export function TopNav({ brand, email, role }: TopNavProps) {
  const pathname = usePathname();
  const { mode, toggleMode } = useAppMode();
  const [profileOpen, setProfileOpen] = useState(false);
  const [dateSelected, setDateSelected] = useState<string>("Today, Dec 7");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [isFabOpen, setIsFabOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click or Escape key
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotificationsOpen(false);
      }
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) {
        setIsFabOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setProfileOpen(false);
        setNotificationsOpen(false);
        setIsFabOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
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

  if (mode === "ai") {
    return (
      <div ref={fabRef} className="fixed top-3.5 sm:top-5 md:top-6 lg:top-7 right-3.5 sm:right-5 md:right-6 lg:right-7 z-50">
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsFabOpen((v) => !v)}
            title={isFabOpen ? "Close menu" : "Navigation menu"}
            aria-label="Navigation menu"
            aria-expanded={isFabOpen}
            aria-haspopup="menu"
            className="h-9 px-3.5 rounded-full bg-neutral-950 text-white shadow-[0_4px_16px_rgba(15,23,42,0.16)] hover:bg-neutral-800 active:scale-[0.98] transition-[background-color,transform] duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 focus-visible:ring-offset-white flex items-center gap-2 select-none"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
            <span className="text-xs font-semibold">AI Mode</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
              className={`h-3.5 w-3.5 text-neutral-300 transition-transform duration-150 ease-out-quart ${
                isFabOpen ? "rotate-180" : ""
              }`}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {isFabOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-2 w-64 rounded-2xl border border-neutral-800 bg-neutral-950 p-2.5 shadow-[0_16px_40px_rgba(15,23,42,0.28)] space-y-2 text-white z-50 animate-fadeIn"
            >
              {/* Single UI Mode Switch Button */}
              <button
                type="button"
                onClick={() => {
                  toggleMode();
                  setIsFabOpen(false);
                }}
                className="w-full h-9 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 px-3 text-xs font-medium flex items-center justify-between text-neutral-200 hover:text-white transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                <span className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-neutral-300" aria-hidden="true">
                    <rect x="3" y="3" width="7" height="9" />
                    <rect x="14" y="3" width="7" height="5" />
                    <rect x="14" y="12" width="7" height="9" />
                    <rect x="3" y="16" width="7" height="5" />
                  </svg>
                  <span>Switch to Dashboard</span>
                </span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 text-neutral-400" aria-hidden="true">
                  <path d="M7 16V4M7 4L3 8M7 4l4 4" />
                  <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </button>

              <div className="h-px bg-neutral-800 my-1" />

              {/* Contextual Route Pill Tabs */}
              <div className="space-y-0.5">
                {aiTabs.map((tab) => {
                  const active = isActive(tab.href);
                  return (
                    <Link
                      key={tab.href}
                      href={tab.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setIsFabOpen(false)}
                      className={`flex items-center justify-between rounded-xl px-3 py-2 text-xs transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                        active
                          ? "bg-white text-neutral-950 font-semibold"
                          : "text-neutral-300 hover:bg-neutral-900 hover:text-white"
                      }`}
                    >
                      <span>{tab.label}</span>
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />}
                    </Link>
                  );
                })}
              </div>

              <div className="h-px bg-neutral-800 my-1" />

              {/* User Identity & Logout */}
              <div className="flex items-center justify-between px-2 pt-0.5 text-[11px] text-neutral-300">
                <span className="truncate max-w-[150px]">{email}</span>
                <button
                  type="button"
                  onClick={signOut}
                  className="text-rose-400 hover:text-rose-300 transition-colors duration-150 ease-out-quart font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 rounded px-1 py-0.5"
                >
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <header className="sticky top-3 z-50 px-3 sm:px-4 md:px-8 max-w-7xl mx-auto w-full">
      <div className="flex items-center justify-between gap-2 sm:gap-3 min-w-0">
        {/* Left: TIX Black Circle Brand Mark */}
        <Link
          href="/"
          className="flex items-center gap-2 group shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-canvas)]"
          title={`${brand.name} - Home`}
        >
          <div className="h-9 w-9 rounded-full bg-neutral-950 text-white flex items-center justify-center font-black tracking-widest text-[11px] transition-transform duration-150 ease-out-quart group-hover:scale-105 group-active:scale-95">
            TIX
          </div>
          <span className="hidden sm:inline-block font-bold tracking-tight text-neutral-950 text-sm">
            {brand.name}
          </span>
        </Link>

        {/* Center: Floating Top Black Navigation Pill Container */}
        <div className="min-w-0 bg-neutral-950 text-white rounded-full p-1 flex items-center gap-1 shadow-[0_4px_16px_rgba(15,23,42,0.14)] overflow-x-auto no-scrollbar max-w-full">
          {/* Single UI Mode Switch Button */}
          <button
            type="button"
            onClick={toggleMode}
            title="Switch to AI Mode"
            aria-label="Switch to AI Mode"
            className="h-8 rounded-full px-3 text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-white transition-[background-color,transform] duration-150 ease-out-quart active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white flex items-center gap-1.5 shrink-0 select-none"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
              <rect x="3" y="3" width="7" height="9" />
              <rect x="14" y="3" width="7" height="5" />
              <rect x="14" y="12" width="7" height="9" />
              <rect x="3" y="16" width="7" height="5" />
            </svg>
            <span>Dashboard</span>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 opacity-80 shrink-0" aria-hidden="true">
              <path d="M7 16V4M7 4L3 8M7 4l4 4" />
              <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>

          {/* Vertical Divider */}
          <div className="h-4 w-px bg-neutral-800 mx-0.5 shrink-0" />

          {/* Contextual Route Pill Tabs */}
          <nav aria-label="Primary" className="flex items-center gap-1 shrink-0">
            {currentTabs.map((tab) => {
              const active = isActive(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`h-8 inline-flex items-center rounded-full px-3.5 text-xs transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white shrink-0 whitespace-nowrap ${
                    active
                      ? "bg-white text-neutral-950 font-semibold"
                      : "text-neutral-300 hover:text-white hover:bg-neutral-800/80"
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
            className="hidden md:flex h-9 items-center gap-1.5 rounded-full bg-white border border-neutral-200 px-3.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 hover:border-neutral-300 active:scale-[0.98] transition-[background-color,border-color,transform] duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-canvas)] select-none"
            title="Filter operational timeframe"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-neutral-600" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="tabular-nums">{dateSelected}</span>
          </button>

          {/* Notifications Icon Button */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              className="h-9 w-9 rounded-full bg-white border border-neutral-200 flex items-center justify-center text-neutral-700 hover:text-neutral-950 hover:bg-neutral-50 hover:border-neutral-300 active:scale-[0.98] transition-[background-color,border-color,color,transform] duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-canvas)] relative"
              title="System Notifications"
              aria-label="System Notifications"
              aria-expanded={notificationsOpen}
              aria-haspopup="true"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" />
            </button>

            {/* Notifications Popover */}
            {notificationsOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-white p-3.5 text-xs text-neutral-950 shadow-[0_12px_32px_rgba(15,23,42,0.14)] ring-1 ring-neutral-950/5 z-50 animate-fadeIn">
                <div className="flex items-center justify-between border-b border-neutral-100 pb-2 mb-1 font-semibold">
                  <span>System Activity</span>
                  <span className="text-[11px] text-emerald-700 font-medium">All normal</span>
                </div>
                <div className="divide-y divide-neutral-100">
                  <div className="py-2.5">
                    <div className="font-medium text-neutral-950">Line 2 Velocity Peak</div>
                    <div className="text-[11px] text-neutral-600 mt-0.5 tabular-nums">Spindle rotation reached 89 units at 4:00 AM.</div>
                  </div>
                  <div className="pt-2.5 pb-0.5">
                    <div className="font-medium text-neutral-950">Telemetry Sync</div>
                    <div className="text-[11px] text-neutral-600 mt-0.5">SAP &amp; Siemens FastMCP connected.</div>
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
              className="h-9 w-9 rounded-full bg-neutral-950 text-white flex items-center justify-center font-bold text-xs hover:bg-neutral-800 active:scale-95 transition-[background-color,transform] duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-canvas)]"
              title={`${email} (${role})`}
              aria-label="User profile menu"
              aria-expanded={profileOpen}
              aria-haspopup="true"
            >
              {userInitial}
            </button>

            {/* Profile Dropdown */}
            {profileOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white p-3.5 text-xs text-neutral-950 shadow-[0_12px_32px_rgba(15,23,42,0.14)] ring-1 ring-neutral-950/5 z-50 animate-fadeIn">
                <div className="flex items-center gap-2.5 pb-3 border-b border-neutral-100">
                  <div className="h-9 w-9 rounded-full bg-neutral-950 text-white flex items-center justify-center font-bold text-xs shrink-0">
                    {userInitial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-neutral-950 truncate" title={email}>
                      {userName}
                    </div>
                    <div className="text-[11px] text-neutral-600 truncate" title={email}>
                      {email}
                    </div>
                  </div>
                </div>

                <div className="py-2.5 flex items-center justify-between">
                  <span className="text-neutral-600 text-[11px]">Role</span>
                  <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-800 capitalize border border-neutral-200">
                    {role}
                  </span>
                </div>

                <div className="pt-2 border-t border-neutral-100">
                  <button
                    type="button"
                    onClick={signOut}
                    className="w-full h-9 flex items-center justify-center gap-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-900 text-xs font-medium transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true">
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
