// apps/web/components/sidebar.tsx
"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Brand } from "@/lib/brand";
import { Logo } from "@/components/logo";

type Item = { href: string; label: string; icon: string; roles?: string[] };

const ITEMS: Item[] = [
  { href: "/", label: "Dashboard", icon: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" },
  { href: "/documents", label: "Documents", icon: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" },
  { href: "/playbooks", label: "Execution", icon: "M5 3l14 9-14 9z" },
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

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/10 bg-black/30 p-4 md:flex">
        <Link href="/" className="mb-6 px-1"><Logo brand={brand} /></Link>
        <nav className="flex-1 space-y-1">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                active(i.href) ? "bg-brand/20 text-white" : "text-neutral-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon d={i.icon} />
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 pt-3 text-xs text-neutral-400">
          <div className="truncate text-neutral-200" title={email}>{email}</div>
          <div className="mb-2 mt-0.5 capitalize">{role}</div>
          <button onClick={signOut} className="rounded-lg border border-white/15 px-2.5 py-1.5 hover:bg-white/5">
            Sign out
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#07080d]/95 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Logo brand={brand} />
          <button onClick={signOut} className="text-xs text-neutral-400">Sign out</button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs ${
                active(i.href) ? "bg-brand/25 text-white" : "text-neutral-400"
              }`}
            >
              {i.label}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
