// apps/web/components/sidebar.tsx
"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Brand } from "@/lib/brand";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

type Item = {
  href: string;
  label: string;
  icon: string;
  roles?: string[];
  badge?: string;
};

const ITEMS: Item[] = [
  { href: "/", label: "Dashboard", icon: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" },
  { href: "/chat", label: "Agent Chat", icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z", badge: "AI" },
  { href: "/documents", label: "Documents", icon: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" },
  { href: "/playbooks", label: "Execution", icon: "M5 3l14 9-14 9z" },
  { href: "/marketplace", label: "Marketplace", icon: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" },
  { href: "/connectors", label: "Connectors", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { href: "/approvals", label: "Approvals", icon: "M5 12l5 5L20 7" },
  { href: "/audit", label: "Audit log", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/team", label: "Team", icon: "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21c0-4 3.6-6 8-6s8 2 8 6", roles: ["admin"] },
  { href: "/settings", label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1a7 7 0 00-2-1l-.5-2h-5l-.5 2a7 7 0 00-2 1l-2-1-2 4 2 1a7 7 0 000 2l-2 1 2 4 2-1a7 7 0 002 1l.5 2h5l.5-2a7 7 0 002-1l2 1 2-4-2-1a7 7 0 000-2z" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function Sidebar({ brand, email, role }: { brand: Brand; email: string; role: string }) {
  const path = usePathname();
  const items = ITEMS.filter((i) => !i.roles || i.roles.includes(role));
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const userInitial = (email?.[0] || "U").toUpperCase();

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white/10 bg-black/40 backdrop-blur-xl p-4 md:flex">
        <Link href="/" className="mb-6 flex items-center px-2 py-1 transition-opacity hover:opacity-90">
          <Logo brand={brand} />
        </Link>
        <nav className="flex-1 space-y-1">
          {items.map((i) => {
            const isItemActive = active(i.href);
            return (
              <Link
                key={i.href}
                href={i.href}
                className={`group relative flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 ${
                  isItemActive
                    ? "bg-brand/15 text-white shadow-sm ring-1 ring-brand/30"
                    : "text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-100"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`transition-colors ${
                      isItemActive ? "text-brand" : "text-neutral-500 group-hover:text-neutral-300"
                    }`}
                  >
                    <Icon d={i.icon} />
                  </span>
                  <span>{i.label}</span>
                </div>
                {i.badge && (
                  <span className="rounded-full bg-brand/20 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                    {i.badge}
                  </span>
                )}
                {isItemActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-brand" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-white/10 pt-4">
          <div className="flex items-center gap-3 mb-3 px-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-brand/40 to-white/10 border border-white/15 text-xs font-bold text-white shadow-inner">
              {userInitial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-neutral-200" title={email}>
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
            className="w-full text-xs text-neutral-300 hover:text-white"
          >
            Sign out
          </Button>
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#07080d]/95 backdrop-blur-md md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Logo brand={brand} />
          <Button variant="ghost" size="sm" onClick={signOut} className="text-xs text-neutral-400">
            Sign out
          </Button>
        </div>
        <nav className="flex gap-1.5 overflow-x-auto px-3 pb-2.5">
          {items.map((i) => {
            const isItemActive = active(i.href);
            return (
              <Link
                key={i.href}
                href={i.href}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
                  isItemActive
                    ? "bg-brand/25 text-white ring-1 ring-brand/40"
                    : "text-neutral-400 hover:text-white hover:bg-white/5"
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
