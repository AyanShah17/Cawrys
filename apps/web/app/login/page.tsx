"use client";
import { useState } from "react";
import { Spotlight } from "@/components/ui/spotlight";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail ?? "login failed");
      window.location.href = "/";
    } catch (e: any) {
      setErr(e.message); setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <Spotlight className="-top-40 left-0 md:-top-20 md:left-60" />
      <form onSubmit={submit} className="relative z-10 w-full max-w-sm space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <h1 className="bg-gradient-to-b from-white to-neutral-500 bg-clip-text text-3xl font-bold text-transparent">Cawrys</h1>
        <p className="text-xs text-neutral-400">Sign in to your workspace.</p>
        <input type="email" required autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-white/15 bg-black px-3 py-2 text-sm" />
        <input type="password" required autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border border-white/15 bg-black px-3 py-2 text-sm" />
        {err && <p className="text-xs text-red-400">{err}</p>}
        <button disabled={busy} className="w-full rounded bg-white py-2 text-sm font-medium text-black disabled:opacity-50">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
