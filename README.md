# Reply Ledger｜回覆帳簿

Human-reviewed LINE reply workspace for lighting retail and clinic-observer
workflows. The product keeps demo cases visibly separate from verified live
LINE events, records incoming events in D1, and never sends from the AI draft
surface automatically.

The public product page lives at `/`. The authenticated operational workspace
lives at `/app`; live LINE records are never rendered on the public route.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## LINE Integration

- Webhook endpoint: `/api/line/webhook`
- Verifies the raw request body with `x-line-signature` and HMAC-SHA256 before parsing.
- Deduplicates redeliveries by LINE `webhookEventId`.
- Stores only the event fields needed by the inbox; raw webhook JSON and reply tokens are not retained.
- `/api/line/send` is authenticated, idempotent, and unavailable until a channel access token is configured.

## Grounded AI analysis

- `/api/ai/analyze` uses the OpenAI Responses API with strict structured output.
- Conversation context and active knowledge rules are read server-side from D1.
- The response is stored in `conversation_analyses`; knowledge rules and operator decisions are stored in durable workspace tables.
- `store: false` is sent to OpenAI. The API key stays server-side.
- AI only produces a review draft. It never calls the LINE send endpoint, and LINE still requires the explicit second confirmation in the workspace.
- When `OPENAI_API_KEY` is absent or analysis fails, the UI says so and falls back to a conservative human-review draft.

### Message storage model

- `line_webhook_events` is the durable inbound event ledger. LINE text cannot be fetched again later, so verified events are written before the webhook returns success.
- `line_outbound_messages` is the durable, idempotent send and audit ledger.
- `line_conversations` is a compact per-contact summary used by the queue. It is updated only when a newer inbound or outbound message arrives, so redelivered older events cannot move a conversation backward.
- `/api/line/conversations` and `/api/line/conversations/:sourceId/messages` use keyset cursors. The UI loads conversation summaries first, then only the selected contact's newest 50 messages; older pages remain available without loading the whole database into the browser.
- Text is stored in D1. For non-text events, the event type and message ID are retained and the UI shows a typed placeholder. Downloaded attachment bytes should use R2 when that workflow is added rather than being stored in D1.

Copy `.env.example` to `.env.local` for local work. Production values belong in
Sites environment variables and must be marked secret:

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_WORKSPACE_MODE` (`retail` or `clinic`)
- `OPENAI_API_KEY` (secret)
- `OPENAI_MODEL` (defaults to `gpt-5.4-mini`)

The dashboard requires Sign in with ChatGPT outside local development. For LINE
to reach the webhook, production must expose the Site publicly while retaining
the page- and API-level checks in this source. Do not enable real clinic traffic
until privacy, retention, and escalation procedures have been reviewed.

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the product and verify rendering plus LINE signature handling
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Three-Minute Demo

The Traditional Chinese narration, burned-in subtitle track, and reproducible
FFmpeg render script live in `demo/`. After capturing the five production
screens into `H:\ReplyLedgerDemo`, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\demo\render-demo.ps1
```

The script produces a 1920×1080, 30 fps, exactly three-minute H.264/AAC video at
`H:\ReplyLedgerDemo\reply-ledger-demo-3min.mp4`.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
