import { ApprovalsList } from "@/components/approvals-list";
import { PageHeader } from "@/components/ui/kit";
import { getMe } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function Approvals() {
  const me = await getMe();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        subtitle="Manage required human-in-the-loop operational approvals. Only approver and admin roles can decide."
      />
      <ApprovalsList canDecide={me?.role === "admin" || me?.role === "approver"} />
    </div>
  );
}
