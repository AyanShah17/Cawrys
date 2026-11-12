// apps/web/app/connectors/page.tsx
import React from "react";
import { ConnectorsView } from "@/components/connectors-view";
import type { MarketplaceCatalog } from "@/components/marketplace-grid";
import { PageHeader } from "@/components/ui/kit";
import { getBrand } from "@/lib/brand";
import { requireMe, safe, serverGet } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connectors" };

export default async function ConnectorsPage() {
  const me = await requireMe();
  const brand = getBrand();
  // Fetch full catalog (limit=0 retrieves all toolkits)
  const data = await safe(serverGet<MarketplaceCatalog>("execution", "/v1/marketplace/apps?limit=0"));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connectors"
        subtitle="Manage configured and successfully authenticated toolkits across Composio.dev and Industrial FastMCP."
      />
      <ConnectorsView initial={data} role={me.role} brandName={brand.name} />
    </div>
  );
}
