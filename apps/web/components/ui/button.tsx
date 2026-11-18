import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

const buttonVariants = {
  variant: {
    default:
      "bg-neutral-950 text-white hover:bg-neutral-800 active:scale-[0.98] focus-visible:ring-neutral-950",
    destructive:
      "bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100 active:scale-[0.98] focus-visible:ring-rose-600",
    outline:
      "border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50 hover:border-neutral-300 hover:text-neutral-950 active:scale-[0.98] focus-visible:ring-neutral-950",
    secondary:
      "bg-neutral-100 text-neutral-900 hover:bg-neutral-200/80 active:scale-[0.98] focus-visible:ring-neutral-950",
    ghost:
      "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 active:scale-[0.98] focus-visible:ring-neutral-950",
    link:
      "text-neutral-950 underline-offset-4 hover:underline p-0 h-auto font-medium focus-visible:ring-neutral-950",
  },
  size: {
    default: "h-9 px-4 py-2 text-sm rounded-full",
    sm: "h-8 rounded-full px-3 text-xs",
    lg: "h-10 rounded-full px-5 text-sm",
    icon: "h-9 w-9 rounded-full p-0 flex items-center justify-center",
  },
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out-quart focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50",
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
