"use client";
import { useState } from "react";
import { Button, inputCls } from "@/components/ui/kit";

const DEMO_ROLES = [
  { role: "admin", email: "admin@cawrys.local" },
  { role: "engineer", email: "engineer@cawrys.local" },
  { role: "approver", email: "approver@cawrys.local" },
] as const;

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
    <main className="flex min-h-screen items-center justify-center bg-[#f4f5f8] px-4 py-8 sm:px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-6 rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8"
      >
        <div className="space-y-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-950 text-sm font-bold tracking-tight text-white">
            C
          </div>
          <h1 className="text-[1.625rem] font-bold leading-[1.2] tracking-[-0.025em] text-neutral-950">
            Sign in to Cawrys
          </h1>
          <p className="text-sm leading-relaxed text-neutral-600">
            Access your industrial operations and execution workspace.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="login-email" className="mb-1.5 block text-xs font-semibold text-neutral-800">
              Work Email
            </label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="username"
              placeholder="admin@cawrys.local"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-xs font-semibold text-neutral-800">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {err && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
          >
            {err}
          </div>
        )}

        <Button type="submit" disabled={busy} size="lg" className="w-full text-sm font-semibold">
          {busy ? "Signing in..." : "Sign in"}
        </Button>

        <div className="border-t border-neutral-100 pt-5">
          <div className="flex items-center justify-between text-xs text-neutral-600">
            <span className="font-semibold text-neutral-800">Demo Roles</span>
            <span>One-click fill</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {DEMO_ROLES.map((item) => {
              const selected = email === item.email;
              return (
                <button
                  key={item.role}
                  type="button"
                  onClick={() => fillDemo(item.email)}
                  className={`h-8 rounded-full border px-3.5 text-xs font-medium transition-colors duration-150 ease-out-quart active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 ${
                    selected
                      ? "border-neutral-950 bg-neutral-950 text-white hover:bg-neutral-800"
                      : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-300 hover:bg-neutral-50"
                  }`}
                >
                  {item.role}
                </button>
              );
            })}
          </div>
        </div>
      </form>
    </main>
  );
}
