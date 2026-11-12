import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

const buttonVariants = {
  variant: {
    default:
      "bg-brand text-white shadow-sm hover:opacity-95 active:scale-[0.98] focus-visible:ring-brand/40",
    destructive:
      "bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 active:scale-[0.98] focus-visible:ring-red-400/40",
    outline:
      "border border-white/15 bg-white/[0.03] text-neutral-200 hover:bg-white/10 hover:text-white active:scale-[0.98] focus-visible:ring-white/20",
    secondary:
      "bg-white/10 text-neutral-100 hover:bg-white/15 active:scale-[0.98] focus-visible:ring-white/20",
    ghost:
      "text-neutral-400 hover:bg-white/5 hover:text-white focus-visible:ring-white/20",
    link:
      "text-brand underline-offset-4 hover:underline p-0 h-auto font-medium",
  },
  size: {
    default: "h-9 px-4 py-2 text-sm",
    sm: "h-8 rounded-md px-3 text-xs",
    lg: "h-10 rounded-md px-6 text-base",
    icon: "h-9 w-9 p-0 flex items-center justify-center",
  },
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-50",
          buttonVariants.variant[variant],
          buttonVariants.size[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
