// apps/web/app/marketplace/page.tsx
import React from "react";
import { redirect } from "next/navigation";
import { MarketplaceGrid, type MarketplaceCatalog } from "@/components/marketplace-grid";
import { PageHeader } from "@/components/ui/kit";
import { getBrand } from "@/lib/brand";
import { requireMe, safe, serverGet } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marketplace" };

export default async function MarketplacePage() {
  const me = await requireMe();
  if (me.role === "engineer") {
    redirect("/connectors");
  }
  const brand = getBrand();
  // Fetch initial slice of 24 toolkits for SSR (payload size ~25 KB vs 3.3 MB)
  const data = await safe(serverGet<MarketplaceCatalog>("execution", "/v1/marketplace/apps?limit=24"));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketplace"
        subtitle="Connect SaaS tools via composio.dev (1,640+ toolkits) and industrial enterprise systems (SAP, Siemens, Rockwell, Dassault, PTC, Oracle) via FastMCP."
      />
      <MarketplaceGrid initial={data} role={me.role} brandName={brand.name} />
    </div>
  );
}
