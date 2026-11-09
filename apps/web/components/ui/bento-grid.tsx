// Aceternity-style Bento grid.
import { cn } from "@/lib/utils";

export function BentoGrid({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-3", className)}>{children}</div>;
}

export function BentoItem({ title, description, className, children }: {
  title: string; description?: string; className?: string; children?: React.ReactNode;
}) {
  return (
    <div className={cn("group/bento rounded-xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-white/25", className)}>
      <div className="text-sm font-semibold text-neutral-100">{title}</div>
      {description && <div className="mt-1 text-xs text-neutral-400">{description}</div>}
      <div className="mt-3">{children}</div>
    </div>
  );
}
