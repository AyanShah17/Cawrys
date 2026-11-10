// apps/web/components/logo.tsx
import React from "react";
import type { Brand } from "@/lib/brand";

export function Logo({ brand }: { brand: Brand }) {
  if (brand.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={brand.logoUrl} alt={brand.name} className="h-7 w-auto max-w-[9rem] object-contain" />;
  }
  const initial = (brand.name.match(/[A-Za-z0-9]/)?.[0] ?? "A").toUpperCase();
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
        {initial}
      </span>
      <span className="text-base font-semibold tracking-tight">{brand.name}</span>
    </span>
  );
}
