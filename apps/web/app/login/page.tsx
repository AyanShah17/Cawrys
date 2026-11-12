"use client";
import { useState } from "react";
import { Spotlight } from "@/components/ui/spotlight";

export default function Login() {
  const [email, setEmail] = useState("admin@cawrys.local");
  const [password, setPassword] = useState("cawrys-demo");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail ?? "login failed");
      window.location.href = "/";
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  function fillDemo(roleEmail: string) {
    setEmail(roleEmail);
    setPassword("cawrys-demo");
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <Spotlight className="-top-40 left-0 md:-top-20 md:left-60" />
      <form onSubmit={submit} className="relative z-10 w-full max-w-sm space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl backdrop-blur-md">
        <div>
          <h1 className="bg-gradient-to-b from-white to-neutral-500 bg-clip-text text-3xl font-bold tracking-tight text-transparent">Cawrys</h1>
          <p className="mt-1 text-xs text-neutral-400">Sign in to your enterprise industrial workspace.</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-neutral-400">Work Email</label>
            <input
              type="email"
              required
              autoComplete="username"
              placeholder="admin@cawrys.local"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-white/15 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-neutral-400">Password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-white/15 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
            />
          </div>
        </div>

        {err && (
          <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-white py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>

        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs text-neutral-400">
          <div className="flex items-center justify-between font-mono text-[11px] text-neutral-300">
            <span>Demo Credentials</span>
            <span className="text-[10px] text-neutral-500">Auto-filled</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => fillDemo("admin@cawrys.local")}
              className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-white/10"
            >
              admin
            </button>
            <button
              type="button"
              onClick={() => fillDemo("engineer@cawrys.local")}
              className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-white/10"
            >
              engineer
            </button>
            <button
              type="button"
              onClick={() => fillDemo("approver@cawrys.local")}
              className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-white/10"
            >
              approver
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}
