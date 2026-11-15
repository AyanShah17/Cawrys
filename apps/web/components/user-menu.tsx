// apps/web/components/user-menu.tsx
"use client";
import React from "react";

export function UserMenu({ email, role }: { email: string; role: string }) {
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <div className="ml-auto flex items-center gap-3 text-xs text-neutral-500">
      <span>
        {email}{" "}
        <span className="rounded-full border border-neutral-200/80 bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700">
          {role}
        </span>
      </span>
      <button
        type="button"
        onClick={logout}
        className="rounded-full border border-neutral-200 bg-white px-3 py-1 font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50 hover:text-neutral-900 hover:border-neutral-300"
      >
        Sign out
      </button>
    </div>
  );
}
