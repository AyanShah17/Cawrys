// apps/web/components/team-manager.tsx
"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { API, patch, post } from "@/lib/api";
import { ago } from "@/lib/format";
import type { UserRow } from "@/lib/types";
import { Badge, Button, Notice, Pill, btnCls, inputCls, tableCls, tdCls, thCls } from "@/components/ui/kit";

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
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Operation failed" });
    } finally {
      setBusy(false);
    }
  }

  const upd = (id: string, body: object, done: string) =>
    act(() => patch(`${API.intelligence}/v1/auth/users/${id}`, body), done);

  return (
    <div className="space-y-6">
      {msg && (
        msg.ok ? (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
            {msg.text}
          </div>
        ) : (
          <Notice tone="bad">{msg.text}</Notice>
        )
      )}

      <div className="-mx-1 overflow-x-auto px-1">
        <table className={tableCls}>
          <thead>
            <tr>
              <th className={thCls}>Person</th>
              <th className={thCls}>Role</th>
              <th className={thCls}>Status</th>
              <th className={thCls}>Last sign-in</th>
              <th className={`${thCls} text-right`}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.email === selfEmail;
              return (
                <tr key={u.id} className="transition-colors duration-150 ease-out-quart hover:bg-neutral-50/80">
                  <td className={`${tdCls} font-medium text-neutral-950`}>
                    <div className="flex items-center gap-2">
                      <span className="truncate">{u.email}</span>
                      {self && <Badge variant="secondary">You</Badge>}
                    </div>
                  </td>
                  <td className={tdCls}>
                    <select
                      aria-label={`Role for ${u.email}`}
                      disabled={busy || self}
                      value={u.role}
                      onChange={(e) => upd(u.id, { role: e.target.value }, "Role updated.")}
                      className={`${inputCls} h-8 w-auto min-w-[6.75rem] py-1 text-xs`}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td className={tdCls}>
                    <Pill value={u.is_active ? "active" : "disabled"} />
                  </td>
                  <td className={`${tdCls} whitespace-nowrap text-xs tabular-nums text-neutral-600`}>
                    {u.last_login_at ? ago(u.last_login_at) : "never"}
                  </td>
                  <td className={`${tdCls} pr-0 text-right`}>
                    <div className="inline-flex flex-wrap items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          const p = window.prompt(`New password for ${u.email} (at least 8 characters)`);
                          if (p) upd(u.id, { password: p }, "Password reset.");
                        }}
                      >
                        Reset password
                      </Button>
                      {!self && (
                        <Button
                          type="button"
                          variant={u.is_active ? "outline" : "default"}
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            upd(
                              u.id,
                              { is_active: !u.is_active },
                              u.is_active ? "Account disabled." : "Account enabled."
                            )
                          }
                        >
                          {u.is_active ? "Disable" : "Enable"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-4 border-t border-neutral-200 pt-6">
        <h3 className="text-sm font-semibold tracking-tight text-neutral-950">Add team member</h3>
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
          <label className="text-xs font-semibold text-neutral-800">
            Email
            <input
              required
              type="email"
              placeholder="name@company.com"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
              className={`${inputCls} mt-1.5`}
            />
          </label>
          <label className="text-xs font-semibold text-neutral-800">
            Temporary password
            <input
              required
              type="password"
              minLength={8}
              autoComplete="new-password"
              placeholder="Minimum 8 characters"
              value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })}
              className={`${inputCls} mt-1.5`}
            />
          </label>
          <label className="text-xs font-semibold text-neutral-800">
            Role
            <select
              value={f.role}
              onChange={(e) => setF({ ...f, role: e.target.value })}
              className={`${inputCls} mt-1.5`}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy} className={btnCls}>
            {busy ? "Saving..." : "Add person"}
          </button>
        </form>

        <dl className="grid gap-2 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3.5 text-xs text-neutral-700 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="font-semibold text-neutral-950">admin</dt>
            <dd className="text-neutral-600">Manages all settings, connectors, and team access.</dd>
          </div>
          <div>
            <dt className="font-semibold text-neutral-950">engineer</dt>
            <dd className="text-neutral-600">Edits documents, tools, and execution playbooks.</dd>
          </div>
          <div>
            <dt className="font-semibold text-neutral-950">approver</dt>
            <dd className="text-neutral-600">Reviews and decides on gated approvals.</dd>
          </div>
          <div>
            <dt className="font-semibold text-neutral-950">viewer</dt>
            <dd className="text-neutral-600">Read-only access across operational views.</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
