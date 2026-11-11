// apps/web/app/team/page.tsx
import React from "react";
import { redirect } from "next/navigation";
import { TeamManager } from "@/components/team-manager";
import { Card, Notice, PageHeader } from "@/components/ui/kit";
import { requireMe, safe, serverGet } from "@/lib/server";
import type { UserRow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team" };

export default async function Team() {
  const me = await requireMe();
  if (me.role !== "admin") redirect("/");
  const users = await safe(serverGet<UserRow[]>("intelligence", "/v1/auth/users"));
  return (
    <div className="space-y-6">
      <PageHeader title="Team" subtitle={`People who can sign in to ${me.tenant_name || "the system"}`} />
      <Card>
        {users ? (
          <TeamManager users={users} selfEmail={me.email} />
        ) : (
          <Notice tone="bad">Could not load the team.</Notice>
        )}
      </Card>
    </div>
  );
}
