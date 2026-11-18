// apps/web/components/mode-switcher.tsx
"use client";

import React from "react";
import { useAppMode } from "@/lib/mode-context";
import { cn } from "@/lib/utils";

interface ModeSwitcherProps {
  className?: string;
  size?: "default" | "sm" | "full";
}

export function ModeSwitcher({ className, size = "default" }: ModeSwitcherProps) {
  const { mode, toggleMode } = useAppMode();

  const isFull = size === "full";
  const isSm = size === "sm";

  return (
    <button
      type="button"
      onClick={toggleMode}
      title={mode === "ai" ? "Switch to Dashboard Mode" : "Switch to AI Mode"}
      aria-label={mode === "ai" ? "Switch to Dashboard Mode" : "Switch to AI Mode"}
      className={cn(
        "relative inline-flex items-center justify-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 text-white font-semibold hover:bg-neutral-800 active:scale-[0.98] transition-[background-color,transform] duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 select-none",
        isSm ? "h-8 px-3 text-xs" : "h-9 px-3.5 text-xs",
        isFull && "flex w-full",
        className
      )}
    >
      {mode === "ai" ? (
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
      ) : (
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
      )}
      <span>{mode === "ai" ? "AI Mode" : "Dashboard"}</span>
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-3 w-3 opacity-70 shrink-0"
        aria-hidden="true"
      >
        <path d="M7 16V4M7 4L3 8M7 4l4 4" />
        <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    </button>
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
