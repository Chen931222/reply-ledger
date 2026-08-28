import { headers } from "next/headers";
import ReplyLedger from "../ReplyLedger";
import { requireChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  if (!host.startsWith("localhost:") && !host.startsWith("127.0.0.1:")) {
    await requireChatGPTUser("/app");
  }
  return <ReplyLedger />;
}
