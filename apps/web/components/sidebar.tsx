// apps/web/components/sidebar.tsx
"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Brand } from "@/lib/brand";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { useAppMode } from "@/lib/mode-context";
import { ModeSwitcher } from "@/components/mode-switcher";

type Item = {
  href: string;
  label: string;
  icon: string;
  roles?: string[];
  badge?: string;
};

// AI Mode navigation items
const AI_ITEMS: Item[] = [
  {
    href: "/chat",
    label: "Agent Chat",
    icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
    badge: "AI",
  },
  {
    href: "/connectors",
    label: "Connectors",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    href: "/marketplace",
    label: "Marketplace",
    icon: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1a7 7 0 00-2-1l-.5-2h-5l-.5 2a7 7 0 00-2 1l-2-1-2 4 2 1a7 7 0 000 2l-2 1 2 4 2-1a7 7 0 002 1l.5 2h5l.5-2a7 7 0 002-1l2 1 2-4-2-1a7 7 0 000-2z",
  },
];

// Dashboard Mode navigation items
const DASHBOARD_ITEMS: Item[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10",
  },
  {
    href: "/documents",
    label: "Documents",
    icon: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  },
  {
    href: "/playbooks",
    label: "Execution",
    icon: "M5 3l14 9-14 9z",
  },
  {
    href: "/approvals",
    label: "Approvals",
    icon: "M5 12l5 5L20 7",
  },
  {
    href: "/audit",
    label: "Audit log",
    icon: "M4 6h16M4 12h16M4 18h10",
  },
  {
    href: "/team",
    label: "Team",
    icon: "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21c0-4 3.6-6 8-6s8 2 8 6",
    roles: ["admin"],
  },
];

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export function Sidebar({ brand, email, role }: { brand: Brand; email: string; role: string }) {
  const path = usePathname();
  const { mode } = useAppMode();

  const rawItems = mode === "ai" ? AI_ITEMS : DASHBOARD_ITEMS;
  const items = rawItems.filter((i) => !i.roles || i.roles.includes(role));
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const userInitial = (email?.[0] || "U").toUpperCase();

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950 p-4 text-neutral-100 md:flex">
        <Link
          href="/"
          className="mb-4 flex items-center px-2 py-1 rounded-lg transition-opacity duration-150 ease-out-quart hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          <Logo brand={brand} />
        </Link>

        {/* Dual Mode Switcher Pill */}
        <div className="mb-4">
          <ModeSwitcher size="full" />
        </div>

        {/* Mode Label */}
        <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-neutral-400">
          {mode === "ai" ? "AI Workspace" : "Plant Operations"}
        </div>

        <nav className="flex-1 space-y-1">
          {items.map((i) => {
            const isItemActive = active(i.href);
            return (
              <Link
                key={i.href}
                href={i.href}
                aria-current={isItemActive ? "page" : undefined}
                className={`group flex items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                  isItemActive
                    ? "bg-white text-neutral-950 font-semibold"
                    : "text-neutral-300 hover:bg-neutral-900 hover:text-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`transition-colors duration-150 ease-out-quart ${
                      isItemActive ? "text-neutral-950" : "text-neutral-400 group-hover:text-neutral-200"
                    }`}
                  >
                    <Icon d={i.icon} />
                  </span>
                  <span>{i.label}</span>
                </div>
                {i.badge && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                      isItemActive ? "bg-neutral-950 text-white" : "bg-blue-600/20 text-blue-300"
                    }`}
                  >
                    {i.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-neutral-800 pt-4">
          <div className="flex items-center gap-3 mb-3 px-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-800 border border-neutral-700 text-xs font-bold text-white">
              {userInitial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-neutral-100" title={email}>
                {email}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="text-[11px] capitalize text-neutral-400">{role}</span>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={signOut}
            className="w-full text-xs border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800 hover:text-white hover:border-neutral-600 focus-visible:ring-white/80 focus-visible:ring-offset-neutral-950"
          >
            Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <header className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950 text-neutral-100 md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Logo brand={brand} />
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="text-xs text-neutral-300 hover:bg-neutral-900 hover:text-white focus-visible:ring-white/80 focus-visible:ring-offset-neutral-950"
          >
            Sign out
          </Button>
        </div>
        <div className="px-3 pb-2">
          <ModeSwitcher size="full" />
        </div>
        <nav className="flex gap-1.5 overflow-x-auto px-3 pb-2.5">
          {items.map((i) => {
            const isItemActive = active(i.href);
            return (
              <Link
                key={i.href}
                href={i.href}
                aria-current={isItemActive ? "page" : undefined}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                  isItemActive
                    ? "bg-white text-neutral-950 font-semibold"
                    : "text-neutral-300 hover:text-white hover:bg-neutral-900"
                }`}
              >
                {i.label}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
