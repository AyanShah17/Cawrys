"use client";

export function UserMenu({ email, role }: { email: string; role: string }) {
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <div className="ml-auto flex items-center gap-3 text-xs text-neutral-400">
      <span>{email} <span className="rounded bg-white/10 px-1.5 py-0.5 text-neutral-200">{role}</span></span>
      <button onClick={logout} className="rounded border border-white/15 px-2 py-1 hover:text-white">Sign out</button>
    </div>
  );
}
