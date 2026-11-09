import { ApprovalsList } from "@/components/approvals-list";
import { getMe } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function Approvals() {
  const me = await getMe();
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h2 className="mb-1 text-xl font-semibold">Approvals</h2>
      <p className="mb-6 text-xs text-neutral-400">Only the approver and admin roles can approve or reject.</p>
      <ApprovalsList canDecide={me?.role === "admin" || me?.role === "approver"} />
    </main>
  );
}
