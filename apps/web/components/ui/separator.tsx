import * as React from "react";
import { cn } from "@/lib/utils";

export function Separator({
  orientation = "horizontal",
  decorative = true,
  className,
  ...props
}: {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role={decorative ? "none" : "separator"}
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-neutral-200",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className
      )}
      {...props}
    />
  );
}
