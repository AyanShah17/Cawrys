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
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200/60 pb-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>}
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
        "rounded-3xl border border-neutral-200/60 bg-white p-6 shadow-sm transition-all duration-200 hover:shadow-md",
        className
      )}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between border-b border-neutral-100 pb-3">
          {title && <h2 className="text-sm font-semibold tracking-tight text-neutral-900">{title}</h2>}
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
  trend,
  trendPositive,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warn" | "good" | "bad";
  trend?: string;
  trendPositive?: boolean;
}) {
  const color =
    tone === "warn"
      ? "text-amber-600"
      : tone === "good"
      ? "text-emerald-600"
      : tone === "bad"
      ? "text-rose-600"
      : "text-neutral-900";

  const isPositive = trendPositive !== undefined ? trendPositive : trend ? trend.startsWith("+") : false;

  return (
    <div className="group relative rounded-3xl border border-neutral-200/60 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:border-neutral-300">
      <div className="flex items-center justify-between gap-1">
        <div className="text-xs font-medium text-neutral-500 truncate">{l}</div>
        {trend && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums shrink-0",
              isPositive
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-rose-50 text-rose-700 border border-rose-200"
            )}
          >
            <span>{trend}</span>
          </span>
        )}
      </div>
      <div className={cn("mt-2 text-2xl font-bold tracking-tight tabular-nums", color)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-neutral-400 font-normal">{hint}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-700 border-emerald-200",
  succeeded: "bg-emerald-50 text-emerald-700 border-emerald-200",
  low: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  needs_review: "bg-amber-50 text-amber-700 border-amber-200",
  awaiting_approval: "bg-amber-50 text-amber-700 border-amber-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
  high: "bg-rose-50 text-rose-700 border-rose-200",
  disabled: "bg-rose-50 text-rose-700 border-rose-200",
  down: "bg-rose-50 text-rose-700 border-rose-200",
  extracting: "bg-sky-50 text-sky-700 border-sky-200",
  running: "bg-sky-50 text-sky-700 border-sky-200",
  pending: "bg-sky-50 text-sky-700 border-sky-200",
};

export function Pill({ value }: { value: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
        TONES[value] ?? "border-neutral-200 bg-neutral-100 text-neutral-700"
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
      ? "border-rose-200 bg-rose-50/90 text-rose-900"
      : tone === "info"
      ? "border-sky-200 bg-sky-50/90 text-sky-900"
      : "border-amber-200 bg-amber-50/90 text-amber-900";
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border p-4 text-sm leading-relaxed shadow-sm", c)}>
      <div className="shrink-0 pt-0.5">
        {tone === "bad" ? (
          <svg className="h-4 w-4 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        ) : tone === "info" ? (
          <svg className="h-4 w-4 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        ) : (
          <svg className="h-4 w-4 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
export const thCls = "pb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500";
export const tdCls = "border-t border-neutral-100 py-3 pr-3 text-neutral-800 transition-colors";
export const inputCls =
  "w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 shadow-sm transition-all duration-150 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 disabled:cursor-not-allowed disabled:opacity-50";
export const btnCls =
  "inline-flex items-center justify-center gap-2 rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
export const btnGhostCls =
  "inline-flex items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm transition-all duration-150 hover:bg-neutral-50 hover:text-neutral-900 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";
