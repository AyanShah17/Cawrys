import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info";
}

const badgeVariants = {
  variant: {
    default: "bg-blue-50 text-blue-800 border-blue-200",
    secondary: "bg-neutral-100 text-neutral-800 border-neutral-200",
    destructive: "bg-rose-50 text-rose-800 border-rose-200",
    outline: "border-neutral-200 text-neutral-800 bg-white",
    success: "bg-emerald-50 text-emerald-800 border-emerald-200",
    warning: "bg-amber-50 text-amber-800 border-amber-200",
    info: "bg-sky-50 text-sky-800 border-sky-200",
  },
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors duration-150 ease-out-quart",
        badgeVariants.variant[variant],
        className
      )}
      {...props}
    />
  );
}
