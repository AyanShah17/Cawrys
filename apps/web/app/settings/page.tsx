// apps/web/app/settings/page.tsx
import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AiTest, PasswordForm } from "@/components/settings-forms";
import { LiteLLMSettingsCard } from "@/components/litellm-settings-card";
import { Card, Notice, PageHeader, Pill } from "@/components/ui/kit";
import { getBrand } from "@/lib/brand";
import { label } from "@/lib/format";
import { requireMe, safe, serverGet } from "@/lib/server";
import type { SystemStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function Settings() {
  const me = await requireMe();
  if (me.role === "engineer") {
    redirect("/chat");
  }
  const brand = getBrand();
  const st = await safe(serverGet<SystemStatus>("intelligence", "/v1/system/status"));
  const admin = me.role === "admin";
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Your account, the connection to the AI, and how this system is branded" />
      <div className="grid gap-5 lg:grid-cols-2">
        <LiteLLMSettingsCard role={me.role} />

        <Card title="Your account">
          <dl className="mb-4 grid grid-cols-1 gap-y-2 border-b border-neutral-100 pb-4 text-sm sm:grid-cols-[7.5rem_1fr]">
            <dt className="text-neutral-600">Email</dt>
            <dd className="min-w-0 break-all font-medium text-neutral-950">{me.email}</dd>
            <dt className="text-neutral-600">Role</dt>
            <dd className="font-medium text-neutral-950">{label(me.role)}</dd>
            <dt className="text-neutral-600">Organisation</dt>
            <dd className="min-w-0 break-words text-neutral-900">{me.tenant_name || "Default organisation"}</dd>
          </dl>
          <PasswordForm />
        </Card>

        <Card title="System">
          {!st ? (
            <Notice tone="bad">Status is unavailable.</Notice>
          ) : (
            <div className="space-y-4 text-sm">
              <ul className="divide-y divide-neutral-100">
                {st.services.map((s) => (
                  <li key={s.name} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                    <span className="min-w-0 font-medium text-neutral-900">
                      {s.name}
                      {s.detail && <span className="ml-2 font-normal text-xs text-neutral-600">{s.detail}</span>}
                    </span>
                    <Pill value={s.ok ? "ok" : "down"} />
                  </li>
                ))}
              </ul>
              <p className="border-t border-neutral-100 pt-3 text-xs tabular-nums text-neutral-600">
                Version {st.version} &middot; {st.env} &middot; files kept on {st.storage}
              </p>
              {st.demo_mode && (
                <Notice tone="warn">Demo mode: results come from a simple built-in stand-in, not a real AI model.</Notice>
              )}
              {admin && st.config && (
                <div className="space-y-3 border-t border-neutral-100 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.06em] text-neutral-600">AI roles</p>
                  <ul className="space-y-1.5 text-xs text-neutral-700">
                    {Object.entries(st.config.ai_roles).map(([k, v]) => (
                      <li key={k} className="flex flex-wrap items-baseline gap-2">
                        <span className="inline-block w-24 shrink-0 text-neutral-600">{label(k)}</span>
                        <code className="break-all font-mono text-neutral-950">{v}</code>
                      </li>
                    ))}
                  </ul>
                  <AiTest />
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="Branding">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3.5 text-sm">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">
                {brand.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-neutral-950">{brand.name}</div>
                <div className="text-xs text-neutral-600">{brand.tagline}</div>
              </div>
              <code className="rounded-lg border border-neutral-200 bg-neutral-100 px-2.5 py-1 font-mono text-xs tabular-nums text-neutral-900">
                {brand.primary}
              </code>
            </div>
            <p className="border-t border-neutral-100 pt-3 text-xs leading-relaxed text-neutral-600">
              Name, tagline, colour, logo and support address are set with the <code className="font-mono text-neutral-800">BRAND_*</code> settings of the deployment and apply after a restart. See <code className="font-mono text-neutral-800">DEPLOYMENT.md</code>.
              {brand.supportEmail && <> Support: {brand.supportEmail}.</>}
            </p>
          </div>
        </Card>
      </div>

      <p className="text-xs text-neutral-600">
        <Link
          href="/licenses"
          className="rounded underline underline-offset-2 transition-colors hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
        >
          Open source licences
        </Link>
      </p>
    </div>
  );
}
