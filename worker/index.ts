/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  LINE_CHANNEL_SECRET?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_WORKSPACE_MODE?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/line/webhook") {
      return handleLineWebhook(request, env);
    }

    if (url.pathname === "/api/line/status") {
      if (!isDashboardRequest(request)) return json({ error: "Unauthorized" }, 401);
      return handleLineStatus(request, env);
    }

    if (url.pathname === "/api/line/inbox") {
      if (!isDashboardRequest(request)) return json({ error: "Unauthorized" }, 401);
      return handleLineInbox(request, env);
    }

    if (url.pathname === "/api/line/outbox") {
      if (!isDashboardRequest(request)) return json({ error: "Unauthorized" }, 401);
      return handleLineOutbox(request, env);
    }

    if (url.pathname === "/api/line/conversations") {
      if (!isDashboardRequest(request)) return json({ error: "Unauthorized" }, 401);
      return handleLineConversations(request, env);
    }

    const messagesMatch = url.pathname.match(/^\/api\/line\/conversations\/([^/]+)\/messages$/);
    if (messagesMatch) {
      if (!isDashboardRequest(request)) return json({ error: "Unauthorized" }, 401);
      let sourceId: string;
      try {
        sourceId = decodeURIComponent(messagesMatch[1]);
      } catch {
        return json({ error: "Invalid LINE source" }, 400);
      }
      return handleLineConversationMessages(request, env, sourceId);
    }

    if (url.pathname === "/api/line/send") {
      if (!isDashboardRequest(request)) return json({ error: "Unauthorized" }, 401);
      return handleLineSend(request, env);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;

type LineSource = { type?: string; userId?: string; groupId?: string; roomId?: string };
type LineWebhookEvent = {
  type?: string;
  webhookEventId?: string;
  timestamp?: number;
  source?: LineSource;
  deliveryContext?: { isRedelivery?: boolean };
  message?: { id?: string; type?: string; text?: string };
};
type LineWebhookBody = { destination?: string; events?: LineWebhookEvent[] };

async function handleLineWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
  if (!env.LINE_CHANNEL_SECRET) return json({ error: "LINE webhook is not configured" }, 503);
  if (!env.DB) return json({ error: "Database is not configured" }, 503);

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 1_000_000) return json({ error: "Payload too large" }, 413);

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 1_000_000) {
    return json({ error: "Payload too large" }, 413);
  }
  const signature = request.headers.get("x-line-signature");
  if (!signature || !(await verifyLineSignature(rawBody, signature, env.LINE_CHANNEL_SECRET))) {
    return json({ error: "Invalid signature" }, 401);
  }

  let payload: LineWebhookBody;
  try {
    payload = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const destination = typeof payload.destination === "string" ? payload.destination : "";
  const events = Array.isArray(payload.events) ? payload.events : [];
  if (events.length > 0) {
    try {
      await storeLineEvents(env.DB, destination, events);
    } catch {
      return json({ error: "Event persistence failed" }, 500);
    }
  }

  return json({ ok: true });
}

async function handleLineStatus(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { Allow: "GET" });

  let databaseReady = false;
  let eventCount = 0;
  let lastEventAt: number | null = null;
  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS event_count, MAX(event_timestamp) AS last_event_at FROM line_webhook_events",
      ).first<{ event_count: number; last_event_at: number | null }>();
      databaseReady = true;
      eventCount = Number(row?.event_count ?? 0);
      lastEventAt = row?.last_event_at == null ? null : Number(row.last_event_at);
    } catch {
      databaseReady = false;
    }
  }

  return json({
    databaseReady,
    receiveReady: databaseReady && Boolean(env.LINE_CHANNEL_SECRET),
    sendReady: databaseReady && Boolean(env.LINE_CHANNEL_ACCESS_TOKEN),
    workspaceMode: env.LINE_WORKSPACE_MODE === "clinic" ? "clinic" : "retail",
    eventCount,
    lastEventAt,
  });
}

async function handleLineInbox(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
  if (!env.DB) return json({ events: [], error: "Database is not configured" }, 503);

  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 50;
  try {
    const result = await env.DB.prepare(
      `SELECT id, webhook_event_id AS webhookEventId, source_type AS sourceType,
              source_id AS sourceId, event_type AS eventType, message_type AS messageType,
              message_text AS messageText, event_timestamp AS eventTimestamp,
              is_redelivery AS isRedelivery
       FROM line_webhook_events
       ORDER BY event_timestamp DESC
       LIMIT ?`,
    ).bind(limit).all();
    return json({ events: result.results });
  } catch {
    return json({ events: [], error: "Database migration is pending" }, 503);
  }
}

async function handleLineOutbox(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
  if (!env.DB) return json({ messages: [], error: "Database is not configured" }, 503);

  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 50;
  try {
    const result = await env.DB.prepare(
      `SELECT request_id AS requestId, target_id AS targetId, message_text AS messageText,
              actor_id AS actorId, actor_email AS actorEmail, status,
              line_request_id AS lineRequestId, error_message AS errorMessage,
              CAST(strftime('%s', created_at) AS INTEGER) * 1000 AS createdTimestamp,
              CASE WHEN sent_at IS NULL THEN NULL
                   ELSE CAST(strftime('%s', sent_at) AS INTEGER) * 1000 END AS sentTimestamp
       FROM line_outbound_messages
       ORDER BY created_at DESC
       LIMIT ?`,
    ).bind(limit).all();
    return json({ messages: result.results });
  } catch {
    return json({ messages: [], error: "Database migration is pending" }, 503);
  }
}

type PageCursor = { timestamp: number; key: string };

function parsePageCursor(value: string | null): PageCursor | null {
  if (!value || value.length > 300) return null;
  const separator = value.indexOf(":");
  if (separator < 1) return null;
  const timestamp = Number(value.slice(0, separator));
  const key = value.slice(separator + 1);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !key) return null;
  return { timestamp, key };
}

function makePageCursor(timestamp: number, key: string) {
  return `${timestamp}:${key}`;
}

function pageLimit(request: Request, fallback: number, maximum: number) {
  const requested = Number(new URL(request.url).searchParams.get("limit") ?? String(fallback));
  return Number.isFinite(requested) ? Math.min(maximum, Math.max(1, Math.floor(requested))) : fallback;
}

async function handleLineConversations(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
  if (!env.DB) return json({ conversations: [], nextCursor: null, error: "Database is not configured" }, 503);

  const url = new URL(request.url);
  const limit = pageLimit(request, 30, 100);
  const statusParam = url.searchParams.get("status") ?? "open";
  if (!new Set(["open", "done", "all"]).has(statusParam)) {
    return json({ error: "Invalid conversation status" }, 400);
  }
  const rawCursor = url.searchParams.get("cursor");
  const cursor = parsePageCursor(rawCursor);
  if (rawCursor && !cursor) return json({ error: "Invalid cursor" }, 400);

  const filters: string[] = [];
  const bindings: Array<string | number> = [];
  if (statusParam !== "all") {
    filters.push("status = ?");
    bindings.push(statusParam);
  }
  if (cursor) {
    filters.push("(last_message_at < ? OR (last_message_at = ? AND source_id > ?))");
    bindings.push(cursor.timestamp, cursor.timestamp, cursor.key);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  try {
    const result = await env.DB.prepare(
      `SELECT source_id AS sourceId, source_type AS sourceType,
              last_message_text AS lastMessageText,
              last_message_direction AS lastMessageDirection,
              last_message_at AS lastMessageAt, status
       FROM line_conversations
       ${where}
       ORDER BY last_message_at DESC, source_id ASC
       LIMIT ?`,
    ).bind(...bindings, limit + 1).all();
    const rows = result.results as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const conversations = rows.slice(0, limit);
    const last = conversations[conversations.length - 1] as { lastMessageAt?: unknown; sourceId?: unknown } | undefined;
    const nextCursor = hasMore && last
      ? makePageCursor(Number(last.lastMessageAt), String(last.sourceId))
      : null;
    return json({ conversations, nextCursor });
  } catch {
    return json({ conversations: [], nextCursor: null, error: "Database migration is pending" }, 503);
  }
}

async function handleLineConversationMessages(request: Request, env: Env, sourceId: string): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
  if (!env.DB) return json({ messages: [], nextCursor: null, error: "Database is not configured" }, 503);
  if (!/^[UCR][A-Za-z0-9_-]{10,}$/.test(sourceId)) return json({ error: "Invalid LINE source" }, 400);

  const url = new URL(request.url);
  const limit = pageLimit(request, 50, 100);
  const rawCursor = url.searchParams.get("cursor");
  const cursor = parsePageCursor(rawCursor);
  if (rawCursor && !cursor) return json({ error: "Invalid cursor" }, 400);
  const cursorWhere = cursor
    ? "WHERE (messageTimestamp < ? OR (messageTimestamp = ? AND messageKey < ?))"
    : "";
  const bindings: Array<string | number> = [sourceId, sourceId];
  if (cursor) bindings.push(cursor.timestamp, cursor.timestamp, cursor.key);

  try {
    const result = await env.DB.prepare(
      `WITH conversation_messages AS (
         SELECT 'inbound' AS direction,
                'IN-' || webhook_event_id AS messageKey,
                COALESCE(message_text,
                  CASE message_type
                    WHEN 'image' THEN '［圖片］'
                    WHEN 'video' THEN '［影片］'
                    WHEN 'audio' THEN '［語音］'
                    WHEN 'file' THEN '［檔案］'
                    WHEN 'sticker' THEN '［貼圖］'
                    WHEN 'location' THEN '［位置］'
                    ELSE '［非文字訊息］'
                  END
                ) AS messageText,
                event_timestamp AS messageTimestamp,
                'received' AS status
         FROM line_webhook_events
         WHERE source_id = ? AND event_type = 'message'
         UNION ALL
         SELECT 'outbound' AS direction,
                'OUT-' || request_id AS messageKey,
                message_text AS messageText,
                COALESCE(
                  CAST(strftime('%s', sent_at) AS INTEGER) * 1000,
                  CAST(strftime('%s', created_at) AS INTEGER) * 1000
                ) AS messageTimestamp,
                status
         FROM line_outbound_messages
         WHERE target_id = ?
       )
       SELECT direction, messageKey, messageText, messageTimestamp, status
       FROM conversation_messages
       ${cursorWhere}
       ORDER BY messageTimestamp DESC, messageKey DESC
       LIMIT ?`,
    ).bind(...bindings, limit + 1).all();
    const rows = result.results as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit);
    const last = messages[messages.length - 1] as { messageTimestamp?: unknown; messageKey?: unknown } | undefined;
    const nextCursor = hasMore && last
      ? makePageCursor(Number(last.messageTimestamp), String(last.messageKey))
      : null;
    return json({ messages, nextCursor });
  } catch {
    return json({ messages: [], nextCursor: null, error: "Database migration is pending" }, 503);
  }
}

async function handleLineSend(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
  if (!env.DB || !env.LINE_CHANNEL_ACCESS_TOKEN) return json({ error: "LINE sending is not configured" }, 503);

  let body: { to?: string; text?: string; requestId?: string };
  try {
    body = await request.json() as { to?: string; text?: string; requestId?: string };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const targetId = body.to?.trim() ?? "";
  const messageText = body.text?.trim() ?? "";
  const requestId = body.requestId?.trim() ?? "";
  if (!/^[UCR][A-Za-z0-9_-]{10,}$/.test(targetId)) return json({ error: "Invalid LINE target" }, 400);
  if (!messageText || messageText.length > 5000) return json({ error: "Message must contain 1–5000 characters" }, 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return json({ error: "A UUID v4 requestId is required" }, 400);
  }

  const actorId = request.headers.get("oai-authenticated-user-id") ?? "local-development";
  const actorEmail = request.headers.get("oai-authenticated-user-email");
  const existing = await env.DB.prepare(
    `SELECT target_id AS targetId, message_text AS messageText, status
     FROM line_outbound_messages WHERE request_id = ?`,
  ).bind(requestId).first<{ targetId: string; messageText: string; status: string }>();

  if (existing) {
    if (existing.targetId !== targetId || existing.messageText !== messageText) {
      return json({ error: "Retry key cannot be reused with different content", retryable: false }, 409);
    }
    if (existing.status === "sent") {
      return json({ error: "Duplicate send request", retryable: false }, 409);
    }
    if (existing.status === "rejected") {
      return json({ error: "The rejected message must be modified before sending again", retryable: false }, 409);
    }
    await env.DB.prepare(
      `UPDATE line_outbound_messages
       SET status = 'pending', error_message = NULL
       WHERE request_id = ?`,
    ).bind(requestId).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO line_outbound_messages
        (request_id, target_id, message_text, actor_id, actor_email, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
    ).bind(requestId, targetId, messageText, actorId, actorEmail).run();
  }

  let lineResponse: Response;
  try {
    lineResponse = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "content-type": "application/json",
        "x-line-retry-key": requestId,
      },
      body: JSON.stringify({
        to: targetId,
        messages: [buildLineFlexMessage(messageText, env.LINE_WORKSPACE_MODE)],
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Network error";
    await markOutboundFailure(env.DB, requestId, message, "failed");
    return json({ error: "LINE API request failed", retryable: true }, 502);
  }

  const lineRequestId = lineResponse.headers.get("x-line-request-id");
  if (lineResponse.status === 409) {
    await markOutboundSent(env.DB, requestId, lineRequestId);
    return json({ ok: true, requestId, lineRequestId, retried: true, format: "flex" });
  }
  if (!lineResponse.ok) {
    const errorText = (await lineResponse.text()).slice(0, 500);
    const retryable = lineResponse.status >= 500;
    await markOutboundFailure(env.DB, requestId, `${lineResponse.status}: ${errorText}`, retryable ? "failed" : "rejected");
    return json({ error: "LINE rejected the message", status: lineResponse.status, retryable }, 502);
  }

  await markOutboundSent(env.DB, requestId, lineRequestId);
  return json({ ok: true, requestId, lineRequestId, format: "flex" });
}

function buildLineFlexMessage(messageText: string, workspaceMode?: string) {
  const clinic = workspaceMode === "clinic";
  const brand = clinic ? "診所回覆觀察員" : "BREME 燈飾顧問";
  const kicker = clinic ? "HUMAN-REVIEWED CARE" : "LIGHTING CONCIERGE";
  const accent = clinic ? "#256B5A" : "#E44D32";
  return {
    type: "flex",
    altText: `${brand}｜${messageText}`.slice(0, 1500),
    contents: {
      type: "bubble",
      size: "mega",
      styles: {
        header: { backgroundColor: "#15150F" },
        body: { backgroundColor: "#F4F0E7" },
        footer: { backgroundColor: "#F4F0E7" },
      },
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        contents: [
          { type: "text", text: kicker, size: "xs", color: accent, weight: "bold" },
          { type: "text", text: brand, size: "xl", color: "#F4F0E7", weight: "bold", margin: "sm" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "22px",
        contents: [
          { type: "text", text: messageText, size: "md", color: "#15150F", wrap: true, lineSpacing: "7px" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        paddingTop: "0px",
        contents: [
          { type: "separator", color: "#C8C2B6" },
          { type: "text", text: "REPLY LEDGER · 已由真人確認", size: "xxs", color: "#777168", margin: "md" },
        ],
      },
    },
  };
}

async function markOutboundSent(db: D1Database, requestId: string, lineRequestId: string | null) {
  const sentTimestamp = Date.now();
  await db.batch([
    db.prepare(
      `UPDATE line_outbound_messages
       SET status = 'sent', line_request_id = ?, error_message = NULL, sent_at = CURRENT_TIMESTAMP
       WHERE request_id = ?`,
    ).bind(lineRequestId, requestId),
    db.prepare(
      `INSERT INTO line_conversations
        (source_id, source_type, last_message_text, last_message_direction,
         last_message_at, status, updated_at)
       SELECT target_id, NULL, message_text, 'outbound',
              ?,
              'done', CURRENT_TIMESTAMP
       FROM line_outbound_messages
       WHERE request_id = ?
       ON CONFLICT(source_id) DO UPDATE SET
         last_message_text = excluded.last_message_text,
         last_message_direction = excluded.last_message_direction,
         last_message_at = excluded.last_message_at,
         status = excluded.status,
         updated_at = CURRENT_TIMESTAMP
       WHERE excluded.last_message_at >= line_conversations.last_message_at`,
    ).bind(sentTimestamp, requestId),
  ]);
}

async function markOutboundFailure(db: D1Database, requestId: string, message: string, status: "failed" | "rejected") {
  await db.prepare(
    `UPDATE line_outbound_messages SET status = ?, error_message = ? WHERE request_id = ?`,
  ).bind(status, message, requestId).run();
}

async function storeLineEvents(db: D1Database, destination: string, events: LineWebhookEvent[]) {
  const statements = events
    .filter((event) => typeof event.webhookEventId === "string" && typeof event.timestamp === "number")
    .flatMap((event) => {
      const source = event.source ?? {};
      const sourceId = source.userId ?? source.groupId ?? source.roomId ?? null;
      const messageText = typeof event.message?.text === "string" ? event.message.text.slice(0, 5000) : null;
      const conversationPreview = lineMessagePreview(event.message, messageText);
      const eventStatement = db.prepare(
        `INSERT OR IGNORE INTO line_webhook_events
          (webhook_event_id, destination, event_type, source_type, source_id,
           event_timestamp, is_redelivery, message_type, message_id, message_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        event.webhookEventId,
        destination,
        event.type ?? "unknown",
        source.type ?? null,
        sourceId,
        event.timestamp,
        event.deliveryContext?.isRedelivery ? 1 : 0,
        event.message?.type ?? null,
        event.message?.id ?? null,
        messageText,
      );
      if (!sourceId || event.type !== "message" || !conversationPreview) return [eventStatement];

      const conversationStatement = db.prepare(
        `INSERT INTO line_conversations
          (source_id, source_type, last_message_text, last_message_direction,
           last_message_at, status, updated_at)
         VALUES (?, ?, ?, 'inbound', ?, 'open', CURRENT_TIMESTAMP)
         ON CONFLICT(source_id) DO UPDATE SET
           source_type = COALESCE(excluded.source_type, line_conversations.source_type),
           last_message_text = excluded.last_message_text,
           last_message_direction = excluded.last_message_direction,
           last_message_at = excluded.last_message_at,
           status = excluded.status,
           updated_at = CURRENT_TIMESTAMP
         WHERE excluded.last_message_at > line_conversations.last_message_at`,
      ).bind(sourceId, source.type ?? null, conversationPreview, event.timestamp);
      return [eventStatement, conversationStatement];
    });

  if (statements.length > 0) await db.batch(statements);
}

function lineMessagePreview(message: LineWebhookEvent["message"], text: string | null) {
  if (text) return text;
  if (!message) return null;
  const labels: Record<string, string> = {
    image: "［圖片］",
    video: "［影片］",
    audio: "［語音］",
    file: "［檔案］",
    sticker: "［貼圖］",
    location: "［位置］",
  };
  return labels[message.type ?? ""] ?? "［非文字訊息］";
}

async function verifyLineSignature(rawBody: string, receivedSignature: string, channelSecret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expected = bytesToBase64(new Uint8Array(signed));
  return timingSafeEqual(expected, receivedSignature);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function isDashboardRequest(request: Request) {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || Boolean(request.headers.get("oai-authenticated-user-id"));
}

function json(value: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}
