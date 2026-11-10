// apps/web/components/ui/kit.tsx
import React from "react";
import { cn } from "@/lib/utils";
import { label } from "@/lib/format";

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-neutral-400">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  );
}

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-white/10 bg-white/[0.03] p-5", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between">
          {title && <h2 className="text-sm font-semibold text-neutral-200">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label: l,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warn" | "good" | "bad";
}) {
  const color =
    tone === "warn"
      ? "text-amber-300"
      : tone === "good"
      ? "text-emerald-300"
      : tone === "bad"
      ? "text-red-300"
      : "text-white";
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs text-neutral-400">{l}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", color)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  ready: "bg-emerald-400/15 text-emerald-300",
  succeeded: "bg-emerald-400/15 text-emerald-300",
  low: "bg-emerald-400/15 text-emerald-300",
  ok: "bg-emerald-400/15 text-emerald-300",
  active: "bg-emerald-400/15 text-emerald-300",
  needs_review: "bg-amber-400/15 text-amber-300",
  awaiting_approval: "bg-amber-400/15 text-amber-300",
  medium: "bg-amber-400/15 text-amber-300",
  failed: "bg-red-400/15 text-red-300",
  rejected: "bg-red-400/15 text-red-300",
  high: "bg-red-400/15 text-red-300",
  disabled: "bg-red-400/15 text-red-300",
  down: "bg-red-400/15 text-red-300",
  extracting: "bg-sky-400/15 text-sky-300",
  running: "bg-sky-400/15 text-sky-300",
  pending: "bg-sky-400/15 text-sky-300",
};

export function Pill({ value }: { value: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-xs",
        TONES[value] ?? "bg-white/10 text-neutral-300"
      )}
    >
      {label(value)}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-neutral-500">{children}</p>;
}

export function Notice({
  tone = "warn",
  children,
}: {
  tone?: "warn" | "bad" | "info";
  children: React.ReactNode;
}) {
  const c =
    tone === "bad"
      ? "border-red-400/30 bg-red-400/10 text-red-200"
      : tone === "info"
      ? "border-sky-400/30 bg-sky-400/10 text-sky-200"
      : "border-amber-400/30 bg-amber-400/10 text-amber-200";
  return <div className={cn("rounded-lg border px-4 py-3 text-sm", c)}>{children}</div>;
}

export const tableCls = "w-full text-left text-sm";
export const thCls = "pb-2 text-xs font-medium text-neutral-500";
export const tdCls = "border-t border-white/5 py-2 pr-3";
export const inputCls =
  "w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm placeholder:text-neutral-600";
export const btnCls =
  "rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50";
export const btnGhostCls =
  "rounded-lg border border-white/15 px-3 py-2 text-sm text-neutral-200 transition hover:bg-white/5 disabled:opacity-50";
