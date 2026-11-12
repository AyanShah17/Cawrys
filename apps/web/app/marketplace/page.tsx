// apps/web/app/marketplace/page.tsx
import React from "react";
import { MarketplaceGrid, type MarketplaceCatalog } from "@/components/marketplace-grid";
import { PageHeader } from "@/components/ui/kit";
import { getBrand } from "@/lib/brand";
import { requireMe, safe, serverGet } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marketplace" };

export default async function MarketplacePage() {
  const me = await requireMe();
  const brand = getBrand();
  // Fetch full catalog (limit=0 retrieves all 1,646+ toolkits without pagination cutoff)
  const data = await safe(serverGet<MarketplaceCatalog>("execution", "/v1/marketplace/apps?limit=0"));

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
