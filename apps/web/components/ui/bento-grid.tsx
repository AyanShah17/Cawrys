// apps/web/components/ui/bento-grid.tsx
import React from "react";
import { cn } from "@/lib/utils";

export function BentoGrid({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-3", className)}>{children}</div>;
}

export function BentoItem({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group/bento rounded-3xl border border-neutral-200/60 bg-white p-6 shadow-sm transition-all duration-200 hover:border-neutral-300 hover:shadow-md",
        className
      )}
    >
      <div className="text-sm font-semibold tracking-tight text-neutral-900">{title}</div>
      {description && <div className="mt-1 text-xs text-neutral-500 leading-relaxed">{description}</div>}
      <div className="mt-3">{children}</div>
    </div>
  );
}
