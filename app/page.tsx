import LandingPage from "./LandingPage";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return (
    <LandingPage
      workspaceHref={user ? "/app" : chatGPTSignInPath("/app")}
      signedIn={Boolean(user)}
    />
  );
}
