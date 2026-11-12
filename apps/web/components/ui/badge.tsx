import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info";
}

const badgeVariants = {
  variant: {
    default: "bg-brand/10 text-brand border-brand/20 hover:bg-brand/15",
    secondary: "bg-neutral-100 text-neutral-700 border-neutral-200 hover:bg-neutral-200/70",
    destructive: "bg-rose-50 text-rose-700 border-rose-200",
    outline: "border-neutral-200 text-neutral-700 bg-white",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    info: "bg-sky-50 text-sky-700 border-sky-200",
  },
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
        badgeVariants.variant[variant],
        className
      )}
      {...props}
    />
  );
}
