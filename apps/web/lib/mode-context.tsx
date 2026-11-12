// apps/web/lib/mode-context.tsx
"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";

export type AppMode = "ai" | "dashboard";

export const MODE_STORAGE_KEY = "cawrys_app_mode";
export const MODE_CHANGE_EVENT = "cawrys_app_mode_changed";

interface ModeContextType {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;
}

const ModeContext = createContext<ModeContextType>({
  mode: "dashboard",
  setMode: () => {},
  toggleMode: () => {},
});

// Paths that strictly belong to AI Mode
const AI_PATHS = ["/chat", "/connectors", "/marketplace"];
// Paths that strictly belong to Dashboard Mode
const DASHBOARD_PATHS = ["/", "/documents", "/playbooks", "/approvals", "/audit", "/team"];

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  // Determine initial mode from path or default to dashboard
  const determineInitialMode = (): AppMode => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(MODE_STORAGE_KEY);
      if (stored === "ai" || stored === "dashboard") {
        return stored;
      }
    }
    if (pathname && AI_PATHS.some((p) => pathname.startsWith(p))) {
      return "ai";
    }
    return "dashboard";
  };

  const [mode, setModeState] = useState<AppMode>("dashboard");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const initial = determineInitialMode();
    setModeState(initial);

    // Sync from localStorage if changed elsewhere
    function handleStorage(e: StorageEvent) {
      if (e.key === MODE_STORAGE_KEY && (e.newValue === "ai" || e.newValue === "dashboard")) {
        setModeState(e.newValue);
      }
    }

    function handleCustomEvent(e: Event) {
      const ce = e as CustomEvent<AppMode>;
      if (ce.detail === "ai" || ce.detail === "dashboard") {
        setModeState(ce.detail);
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(MODE_CHANGE_EVENT, handleCustomEvent);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(MODE_CHANGE_EVENT, handleCustomEvent);
    };
  }, []);

  // Update mode state and localStorage
  const setMode = useCallback(
    (newMode: AppMode) => {
      setModeState(newMode);
      if (typeof window !== "undefined") {
        localStorage.setItem(MODE_STORAGE_KEY, newMode);
        window.dispatchEvent(new CustomEvent(MODE_CHANGE_EVENT, { detail: newMode }));
      }

      // Smooth redirection if necessary
      if (newMode === "ai") {
        // If currently on a dashboard-specific page, redirect to /chat
        const isDashboardPage = DASHBOARD_PATHS.some((p) =>
          p === "/" ? pathname === "/" : pathname.startsWith(p)
        );
        if (isDashboardPage) {
          router.push("/chat");
        }
      } else {
        // If currently on an AI-specific page (e.g. /chat or /connectors), redirect to /
        if (pathname === "/chat" || pathname.startsWith("/connectors")) {
          router.push("/");
        }
      }
    },
    [pathname, router]
  );

  const toggleMode = useCallback(() => {
    setMode(mode === "ai" ? "dashboard" : "ai");
  }, [mode, setMode]);

  return (
    <ModeContext.Provider value={{ mode, setMode, toggleMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useAppMode() {
  return useContext(ModeContext);
}
