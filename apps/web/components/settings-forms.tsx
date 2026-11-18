// apps/web/components/settings-forms.tsx
"use client";
import React, { useState } from "react";
import { API, post } from "@/lib/api";
import { btnCls, btnGhostCls, inputCls } from "@/components/ui/kit";

export function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await post(`${API.intelligence}/v1/auth/me/password`, {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setMsg({ ok: true, text: "Password updated successfully." });
      setCurrentPassword("");
      setNewPassword("");
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to update password." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {msg && (
        <div
          role={msg.ok ? "status" : "alert"}
          className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
            msg.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          {msg.text}
        </div>
      )}
      <label className="block text-xs font-semibold text-neutral-800">
        Current password
        <input
          required
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={`${inputCls} mt-1.5`}
        />
      </label>
      <label className="block text-xs font-semibold text-neutral-800">
        New password
        <input
          required
          type="password"
          minLength={8}
          autoComplete="new-password"
          placeholder="Minimum 8 characters"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={`${inputCls} mt-1.5`}
        />
      </label>
      <div className="pt-1">
        <button type="submit" disabled={busy} className={btnCls}>
          {busy ? "Updating..." : "Update password"}
        </button>
      </div>
    </form>
  );
}

export function AiTest() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; latency_ms?: number; tokens?: number; error?: string; demo_mode?: boolean } | null>(null);

  async function runTest() {
    setBusy(true);
    setRes(null);
    try {
      const data = await post<{ ok: boolean; latency_ms?: number; tokens?: number; error?: string; demo_mode?: boolean }>(
        `${API.intelligence}/v1/system/ai-test`
      );
      setRes(data);
    } catch (e: unknown) {
      setRes({ ok: false, error: e instanceof Error ? e.message : "Connection failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <button type="button" disabled={busy} onClick={runTest} className={btnGhostCls}>
        {busy ? "Testing connection..." : "Test AI connection"}
      </button>
      {res && (
        <div
          role={res.ok ? "status" : "alert"}
          className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium tabular-nums ${
            res.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          {res.ok ? (
            <span>
              Connected ({res.latency_ms} ms, {res.tokens} tokens)
              {res.demo_mode && " · Demo mode"}
            </span>
          ) : (
            <span>Error: {res.error}</span>
          )}
        </div>
      )}
    </div>
  );
}
