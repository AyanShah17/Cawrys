// Neutral ambient highlight wrapper preserved for backwards-compatible exports.
import { cn } from "@/lib/utils";

export function Spotlight({ className, fill }: { className?: string; fill?: string }) {
  void fill;
  return <div aria-hidden="true" className={cn("pointer-events-none hidden", className)} />;
}
