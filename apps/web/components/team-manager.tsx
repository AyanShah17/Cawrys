// apps/web/components/team-manager.tsx
"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { API, patch, post } from "@/lib/api";
import { ago } from "@/lib/format";
import type { UserRow } from "@/lib/types";
import { Pill, btnCls, btnGhostCls, inputCls, tableCls, tdCls, thCls } from "@/components/ui/kit";

const ROLES = ["admin", "engineer", "approver", "viewer"] as const;

export function TeamManager({ users, selfEmail }: { users: UserRow[]; selfEmail: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ email: "", password: "", role: "viewer" });

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: done });
      router.refresh();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const upd = (id: string, body: object, done: string) =>
    act(() => patch(`${API.intelligence}/v1/auth/users/${id}`, body), done);

  return (
    <div className="space-y-6">
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-300" : "text-red-400"}`}>
          {msg.text}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className={tableCls}>
          <thead>
            <tr>
              <th className={thCls}>Person</th>
              <th className={thCls}>Role</th>
              <th className={thCls}>Status</th>
              <th className={thCls}>Last sign-in</th>
              <th className={thCls}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.email === selfEmail;
              return (
                <tr key={u.id}>
                  <td className={tdCls}>
                    {u.email}
                    {self && <span className="ml-2 text-xs text-neutral-500">you</span>}
                  </td>
                  <td className={tdCls}>
                    <select
                      aria-label={`Role for ${u.email}`}
                      disabled={busy || self}
                      value={u.role}
                      onChange={(e) => upd(u.id, { role: e.target.value }, "Role updated.")}
                      className={`${inputCls} w-auto py-1`}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td className={tdCls}>
                    <Pill value={u.is_active ? "active" : "disabled"} />
                  </td>
                  <td className={`${tdCls} text-xs text-neutral-500`}>
                    {u.last_login_at ? ago(u.last_login_at) : "never"}
                  </td>
                  <td className={`${tdCls} space-x-2 whitespace-nowrap text-right`}>
                    <button
                      disabled={busy}
                      className={btnGhostCls}
                      onClick={() => {
                        const p = window.prompt(`New password for ${u.email} (at least 8 characters)`);
                        if (p) upd(u.id, { password: p }, "Password reset.");
                      }}
                    >
                      Reset password
                    </button>
                    {!self && (
                      <button
                        disabled={busy}
                        className={btnGhostCls}
                        onClick={() =>
                          upd(
                            u.id,
                            { is_active: !u.is_active },
                            u.is_active ? "Account disabled." : "Account enabled."
                          )
                        }
                      >
                        {u.is_active ? "Disable" : "Enable"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form
        className="grid items-end gap-3 sm:grid-cols-[2fr_2fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            await post(`${API.intelligence}/v1/auth/users`, f);
            setF({ email: "", password: "", role: "viewer" });
          }, "Person added.");
        }}
      >
        <label className="text-xs text-neutral-400">
          Email
          <input
            required
            type="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            className={`${inputCls} mt-1`}
          />
        </label>
        <label className="text-xs text-neutral-400">
          Temporary password
          <input
            required
            type="password"
            minLength={8}
            autoComplete="new-password"
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
            className={`${inputCls} mt-1`}
          />
        </label>
        <label className="text-xs text-neutral-400">
          Role
          <select
            value={f.role}
            onChange={(e) => setF({ ...f, role: e.target.value })}
            className={`${inputCls} mt-1`}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <button disabled={busy} className={btnCls}>Add person</button>
      </form>
      <p className="text-xs text-neutral-500">
        Roles: <b>admin</b> manages everything · <b>engineer</b> edits tools and playbooks · <b>approver</b> decides on approvals · <b>viewer</b> read only. Changes take effect immediately.
      </p>
    </div>
  );
}
