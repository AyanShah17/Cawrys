"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useAppMode } from "@/lib/mode-context";
import { TopNav } from "@/components/top-nav";
import type { Brand } from "@/lib/brand";

export function LayoutWrapper({
  brand,
  email,
  role,
  children,
}: {
  brand: Brand;
  email: string;
  role: string;
  children: React.ReactNode;
}) {
  const { mode } = useAppMode();
  const pathname = usePathname();
  const isAiPage = mode === "ai" || (pathname && pathname.startsWith("/chat"));

  if (isAiPage) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-[#f4f5f8] relative">
        <TopNav brand={brand} email={email} role={role} />
        <main className="h-full w-full overflow-hidden">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f4f5f8]">
      <TopNav brand={brand} email={email} role={role} />
      <main className="min-w-0 flex-1 px-4 py-3 md:px-8 md:py-5">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
