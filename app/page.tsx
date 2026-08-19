import ReplyLedger from "./ReplyLedger";
import { headers } from "next/headers";
import { requireChatGPTUser } from "./chatgpt-auth";

export default async function Home() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  if (!host.startsWith("localhost:") && !host.startsWith("127.0.0.1:")) {
    await requireChatGPTUser("/");
  }
  return <ReplyLedger />;
}
