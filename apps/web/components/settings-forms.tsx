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
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || "Failed to update password." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-emerald-300" : "text-red-400"}`}>
          {msg.text}
        </p>
      )}
      <label className="block text-xs text-neutral-400">
        Current password
        <input
          required
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={`${inputCls} mt-1`}
        />
      </label>
      <label className="block text-xs text-neutral-400">
        New password
        <input
          required
          type="password"
          minLength={8}
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={`${inputCls} mt-1`}
        />
      </label>
      <button disabled={busy} className={btnCls}>Update password</button>
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
    } catch (e: any) {
      setRes({ ok: false, error: e.message || "Connection failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button disabled={busy} onClick={runTest} className={btnGhostCls}>
        {busy ? "Testing connection..." : "Test AI connection"}
      </button>
      {res && (
        <div className={`text-xs ${res.ok ? "text-emerald-300" : "text-red-400"}`}>
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
