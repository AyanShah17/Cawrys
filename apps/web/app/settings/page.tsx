// apps/web/app/settings/page.tsx
import React from "react";
import Link from "next/link";
import { AiTest, PasswordForm } from "@/components/settings-forms";
import { Card, Notice, PageHeader, Pill } from "@/components/ui/kit";
import { getBrand } from "@/lib/brand";
import { label } from "@/lib/format";
import { requireMe, safe, serverGet } from "@/lib/server";
import type { SystemStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function Settings() {
  const me = await requireMe();
  const brand = getBrand();
  const st = await safe(serverGet<SystemStatus>("intelligence", "/v1/system/status"));
  const admin = me.role === "admin";
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Your account, the connection to the AI, and how this system is branded" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Your account">
          <dl className="mb-4 grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
            <dt className="text-neutral-500">Email</dt>
            <dd>{me.email}</dd>
            <dt className="text-neutral-500">Role</dt>
            <dd>{label(me.role)}</dd>
            <dt className="text-neutral-500">Organisation</dt>
            <dd>{me.tenant_name || "Default organisation"}</dd>
          </dl>
          <PasswordForm />
        </Card>

        <Card title="System">
          {!st ? (
            <Notice tone="bad">Status is unavailable.</Notice>
          ) : (
            <div className="space-y-3 text-sm">
              <ul className="space-y-1.5">
                {st.services.map((s) => (
                  <li key={s.name} className="flex items-center justify-between">
                    <span>
                      {s.name}
                      {s.detail && <span className="ml-2 text-xs text-neutral-500">{s.detail}</span>}
                    </span>
                    <Pill value={s.ok ? "ok" : "down"} />
                  </li>
                ))}
              </ul>
              <p className="text-xs text-neutral-500">
                Version {st.version} · {st.env} · files kept on {st.storage}
              </p>
              {st.demo_mode && (
                <Notice tone="warn">Demo mode: results come from a simple built-in stand-in, not a real AI model.</Notice>
              )}
              {admin && st.config && (
                <div className="border-t border-white/10 pt-3">
                  <p className="mb-2 text-xs font-medium text-neutral-400">AI roles</p>
                  <ul className="mb-3 space-y-1 text-xs text-neutral-400">
                    {Object.entries(st.config.ai_roles).map(([k, v]) => (
                      <li key={k}>
                        <span className="inline-block w-24 text-neutral-500">{label(k)}</span>
                        <code>{v}</code>
                      </li>
                    ))}
                  </ul>
                  <AiTest />
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card title="Branding">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand font-bold text-white">
            {brand.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <div className="font-medium">{brand.name}</div>
            <div className="text-xs text-neutral-500">{brand.tagline}</div>
          </div>
          <code className="rounded bg-white/10 px-2 py-1 text-xs">{brand.primary}</code>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Name, tagline, colour, logo and support address are set with the BRAND_* settings of the deployment and apply after a restart. See DEPLOYMENT.md.
          {brand.supportEmail && <> Support: {brand.supportEmail}.</>}
        </p>
      </Card>
      <p className="text-xs text-neutral-500">
        <Link href="/licenses" className="underline">Open source licences</Link>
      </p>
    </div>
  );
}
