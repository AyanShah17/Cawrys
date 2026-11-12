// apps/web/app/chat/page.tsx
import React from "react";
import { ChatInterface } from "@/components/chat-interface";
import { PageHeader } from "@/components/ui/kit";
import { requireMe, safe, serverGet } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent Chat" };

type ChatToolsResponse = {
  ok: boolean;
  connections: Array<{
    app_key: string;
    app_name: string;
    status: string;
    auth_mode: string;
  }>;
  tools: Array<{
    name: string;
    description: string;
    connector: string;
    risk: string;
  }>;
  overrides: Record<string, any>;
  suggested_prompts: string[];
};

export default async function ChatPage() {
  const me = await requireMe();

  const data = await safe(
    serverGet<ChatToolsResponse>("execution", "/v1/chat/tools")
  );

  const docsData = await safe(
    serverGet<any>("intelligence", "/v1/documents?limit=100")
  );
  const docsCount = Array.isArray(docsData)
    ? docsData.length
    : (docsData?.total ?? docsData?.items?.length ?? 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Agent Chat"
        subtitle="Chat with your connected marketplace data (SAP S/4HANA, Siemens PLM, GitHub, Slack) and control your live operational dashboard."
      />
      <ChatInterface
        role={me.role}
        initialConnections={data?.connections ?? []}
        initialTools={data?.tools ?? []}
        initialOverrides={data?.overrides ?? {}}
        initialDocsCount={docsCount}
      />
    </div>
  );
}
