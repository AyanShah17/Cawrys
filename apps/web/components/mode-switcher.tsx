// apps/web/components/mode-switcher.tsx
"use client";

import React from "react";
import { useAppMode, type AppMode } from "@/lib/mode-context";
import { cn } from "@/lib/utils";

interface ModeSwitcherProps {
  className?: string;
  size?: "default" | "sm" | "full";
}

export function ModeSwitcher({ className, size = "default" }: ModeSwitcherProps) {
  const { mode, setMode } = useAppMode();

  const isFull = size === "full";
  const isSm = size === "sm";

  return (
    <div
      role="group"
      aria-label="Application Mode Switcher"
      className={cn(
        "relative inline-flex items-center rounded-full border border-neutral-800 bg-neutral-950 p-1 shadow-lg backdrop-blur-xl transition-all",
        isFull && "flex w-full",
        className
      )}
    >
      {/* AI Mode Pill Button */}
      <button
        type="button"
        role="tab"
        aria-selected={mode === "ai"}
        onClick={() => setMode("ai")}
        className={cn(
          "relative flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-200 select-none",
          isSm ? "px-3 py-1 text-xs" : "px-3.5 py-1.5 text-xs",
          isFull && "flex-1",
          mode === "ai"
            ? "bg-white text-neutral-950 font-semibold shadow-sm"
            : "text-neutral-400 hover:text-white"
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("shrink-0", isSm ? "h-3.5 w-3.5" : "h-4 w-4")}
          aria-hidden="true"
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        <span>AI Mode</span>
        {mode === "ai" && (
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        )}
      </button>

      {/* Dashboard Mode Pill Button */}
      <button
        type="button"
        role="tab"
        aria-selected={mode === "dashboard"}
        onClick={() => setMode("dashboard")}
        className={cn(
          "relative flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-200 select-none",
          isSm ? "px-3 py-1 text-xs" : "px-3.5 py-1.5 text-xs",
          isFull && "flex-1",
          mode === "dashboard"
            ? "bg-white text-neutral-950 font-semibold shadow-sm"
            : "text-neutral-400 hover:text-white"
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("shrink-0", isSm ? "h-3.5 w-3.5" : "h-4 w-4")}
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="9" />
          <rect x="14" y="3" width="7" height="5" />
          <rect x="14" y="12" width="7" height="9" />
          <rect x="3" y="16" width="7" height="5" />
        </svg>
        <span>Dashboard</span>
        {mode === "dashboard" && (
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        )}
      </button>
    </div>
  );
}

export function FloatingHeaderModeSwitcher({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "sticky top-3 z-30 flex items-center justify-center pointer-events-none mb-4",
        className
      )}
    >
      <div className="pointer-events-auto">
        <ModeSwitcher />
      </div>
    </div>
  );
}
