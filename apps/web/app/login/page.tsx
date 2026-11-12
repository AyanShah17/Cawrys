"use client";
import { useState } from "react";

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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 bg-[#f4f5f8]">
      <form
        onSubmit={submit}
        className="relative z-10 w-full max-w-sm space-y-5 rounded-3xl border border-neutral-200/80 bg-white p-8 shadow-xl"
      >
        <div className="flex flex-col items-center text-center">
          <div className="h-12 w-12 rounded-full bg-neutral-950 text-white flex items-center justify-center font-black tracking-widest text-sm shadow-md border border-neutral-800 mb-3">
            TIX
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Sign in to Cawrys
          </h1>
          <p className="mt-1 text-xs text-neutral-500">
            Access your enterprise industrial workspace.
          </p>
        </div>

        <div className="space-y-3.5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-700">Work Email</label>
            <input
              type="email"
              required
              autoComplete="username"
              placeholder="admin@cawrys.local"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:bg-white focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 transition-colors"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-700">Password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:bg-white focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 transition-colors"
            />
          </div>
        </div>

        {err && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-800">
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-neutral-950 hover:bg-neutral-800 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>

        <div className="rounded-2xl border border-neutral-200/70 bg-neutral-50 p-3.5 text-xs text-neutral-600">
          <div className="flex items-center justify-between text-[11px] font-medium text-neutral-700">
            <span>Demo Roles</span>
            <span className="text-[10px] text-neutral-400">One-click fill</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => fillDemo("admin@cawrys.local")}
              className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-800 hover:bg-neutral-100 font-medium transition shadow-xs"
            >
              admin
            </button>
            <button
              type="button"
              onClick={() => fillDemo("engineer@cawrys.local")}
              className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-800 hover:bg-neutral-100 font-medium transition shadow-xs"
            >
              engineer
            </button>
            <button
              type="button"
              onClick={() => fillDemo("approver@cawrys.local")}
              className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-800 hover:bg-neutral-100 font-medium transition shadow-xs"
            >
              approver
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}
