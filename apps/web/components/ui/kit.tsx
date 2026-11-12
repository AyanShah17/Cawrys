// apps/web/components/ui/kit.tsx
import React from "react";
import { cn } from "@/lib/utils";
import { label } from "@/lib/format";

// Export Shadcn Primitives
export * from "./button";
export * from "./card";
export * from "./badge";
export * from "./input";
export * from "./tabs";
export * from "./separator";
export * from "./dialog";

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
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-white/5 pb-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
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
    <section
      className={cn(
        "rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.03] to-white/[0.01] p-5 shadow-sm backdrop-blur-sm transition-all duration-200 hover:border-white/15",
        className
      )}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between border-b border-white/5 pb-3">
          {title && <h2 className="text-sm font-semibold tracking-tight text-neutral-100">{title}</h2>}
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
    <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-4 shadow-sm transition-all duration-200 hover:border-white/20">
      <div className="text-xs font-medium text-neutral-400">{l}</div>
      <div className={cn("mt-1.5 text-2xl font-bold tracking-tight tabular-nums", color)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-neutral-500 font-normal">{hint}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  ready: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  succeeded: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  low: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  ok: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  needs_review: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  awaiting_approval: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  failed: "bg-red-500/15 text-red-300 border-red-500/30",
  rejected: "bg-red-500/15 text-red-300 border-red-500/30",
  high: "bg-red-500/15 text-red-300 border-red-500/30",
  disabled: "bg-red-500/15 text-red-300 border-red-500/30",
  down: "bg-red-500/15 text-red-300 border-red-500/30",
  extracting: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  running: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  pending: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

export function Pill({ value }: { value: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
        TONES[value] ?? "border-white/10 bg-white/10 text-neutral-300"
      )}
    >
      {label(value)}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-neutral-400">{children}</p>;
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
      ? "border-red-500/30 bg-red-500/10 text-red-200"
      : tone === "info"
      ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
      : "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-4 text-sm leading-relaxed backdrop-blur-sm", c)}>
      <div className="shrink-0 pt-0.5">
        {tone === "bad" ? (
          <svg className="h-4 w-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        ) : tone === "info" ? (
          <svg className="h-4 w-4 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        ) : (
          <svg className="h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export const tableCls = "w-full text-left text-sm border-collapse";
export const thCls = "pb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400";
export const tdCls = "border-t border-white/5 py-3 pr-3 text-neutral-200 transition-colors";
export const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/40 px-3.5 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 shadow-sm transition-all duration-150 focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50";
export const btnCls =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:opacity-95 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
export const btnGhostCls =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.03] px-3.5 py-2 text-sm font-medium text-neutral-200 shadow-sm transition-all duration-150 hover:bg-white/10 hover:text-white active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
