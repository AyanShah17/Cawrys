// apps/web/components/user-menu.tsx
"use client";
import React from "react";

export function UserMenu({ email, role }: { email: string; role: string }) {
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <div className="ml-auto flex items-center gap-3 text-xs text-neutral-600">
      <span>
        {email}{" "}
        <span className="rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5 font-medium text-neutral-800">
          {role}
        </span>
      </span>
      <button
        type="button"
        onClick={logout}
        className="h-8 rounded-full border border-neutral-200 bg-white px-3 font-medium text-neutral-800 transition-[background-color,border-color,color,transform] duration-150 ease-out-quart hover:bg-neutral-50 hover:text-neutral-950 hover:border-neutral-300 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
      >
        Sign out
      </button>
    </div>
  );
}
