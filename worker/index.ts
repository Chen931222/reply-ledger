/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { analyzeWithRules, type AnalysisKnowledgeRule, type AnalysisMessage, type RuleAnalysis } from "./rule-engine";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  LINE_CHANNEL_SECRET?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_WORKSPACE_MODE?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
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

    if (url.pathname === "/api/leads") {
      return handleSalesLead(request, env);
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

    const conversationActionMatch = url.pathname.match(/^\/api\/line\/conversations\/([^/]+)\/(notes|assignment)$/);
    if (conversationActionMatch) {
      if (!isDashboardRequest(request)) return json({ error: "Unauthorized" }, 401);
      let sourceId: string;
      try {
        sourceId = decodeURIComponent(conversationActionMatch[1]);
      } catch {
        return json({ error: "Invalid LINE source" }, 400);
      }
      return conversationActionMatch[2] === "notes"
        ? handleConversationNotes(request, env, sourceId)
        : handleConversationAssignment(request, env, sourceId);
    }

    if (url.pathname === "/api/line/send") {
      if (!isDashboardRequest(request)) return json({ error: "Unauthorized" }, 401);
      return handleLineSend(request, env);
    }

    if (url.pathname === "/api/workspace/knowledge") {
      if (!isDashboardRequest(request)) return json({ error: "Unauthorized" }, 401);
      return handleWorkspaceKnowledge(request, env);
    }

    if (url.pathname === "/api/workspace/audit") {
      if (!isDashboardRequest(request)) return json({ error: "Unauthorized" }, 401);
      return handleWorkspaceAudit(request, env);
    }

    if (url.pathname === "/api/ai/analyze") {
      if (!isDashboardRequest(request)) return json({ error: "Unauthorized" }, 401);
      return handleConversationAnalysis(request, env);
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

async function handleSalesLead(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
  if (!isSameOriginWrite(request)) return json({ error: "Invalid request origin" }, 403);
  if (!env.DB) return json({ error: "Application storage is not configured" }, 503);

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 20_000) return json({ error: "Payload too large" }, 413);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const field = (name: string, limit: number) => typeof body[name] === "string" ? body[name].trim().slice(0, limit) : "";
  const requestType = field("requestType", 20);
  const companyName = field("companyName", 120);
  const contactName = field("contactName", 80);
  const email = field("email", 180).toLowerCase();
  const phoneOrLine = field("phoneOrLine", 80);
  const monthlyVolume = field("monthlyVolume", 40);
  const note = field("note", 1000);
  const website = field("website", 200);

  // A bot that fills the invisible field receives a normal response without creating junk data.
  if (website) return json({ ok: true });
  if (!new Set(["trial", "demo"]).has(requestType)) return json({ error: "請選擇申請試用或預約 Demo" }, 400);
  if (companyName.length < 2 || contactName.length < 2) return json({ error: "請填寫公司與聯絡人名稱" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "請填寫有效的 Email" }, 400);

  const now = Date.now();
  try {
    const duplicate = await env.DB.prepare(
      `SELECT id FROM sales_leads
       WHERE email = ? AND request_type = ? AND created_at >= ?
       LIMIT 1`,
    ).bind(email, requestType, now - 10 * 60_000).first<{ id: string }>();
    if (duplicate) return json({ ok: true, duplicate: true });

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO sales_leads
        (id, request_type, company_name, contact_name, email, phone_or_line,
         monthly_volume, note, source, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'landing', 'new', ?)`,
    ).bind(
      id,
      requestType,
      companyName,
      contactName,
      email,
      phoneOrLine || null,
      monthlyVolume || null,
      note || null,
      now,
    ).run();
    return json({ ok: true, id }, 201);
  } catch {
    return json({ error: "申請暫時無法送出，請稍後再試" }, 503);
  }
}

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
    aiReady: databaseReady && Boolean(env.OPENAI_API_KEY),
    analysisReady: databaseReady,
    analysisMode: env.OPENAI_API_KEY ? "openai" : "rules",
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
  const sortParam = url.searchParams.get("sort") ?? "newest";
  if (!new Set(["newest", "oldest"]).has(sortParam)) {
    return json({ error: "Invalid conversation sort" }, 400);
  }
  const searchQuery = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const scopeParam = url.searchParams.get("scope") ?? "all";
  if (!new Set(["all", "mine", "unassigned", "overdue"]).has(scopeParam)) {
    return json({ error: "Invalid conversation scope" }, 400);
  }
  const rawCursor = url.searchParams.get("cursor");
  const cursor = parsePageCursor(rawCursor);
  if (rawCursor && !cursor) return json({ error: "Invalid cursor" }, 400);

  const filters: string[] = [];
  const bindings: Array<string | number> = [];
  const countFilters: string[] = [];
  const countBindings: Array<string | number> = [];
  if (searchQuery) {
    const searchPattern = `%${searchQuery}%`;
    filters.push("(source_id LIKE ? OR last_message_text LIKE ?)");
    bindings.push(searchPattern, searchPattern);
    countFilters.push("(source_id LIKE ? OR last_message_text LIKE ?)");
    countBindings.push(searchPattern, searchPattern);
  }
  if (statusParam !== "all") {
    filters.push("status = ?");
    bindings.push(statusParam);
  }
  if (scopeParam === "mine") {
    filters.push("assigned_actor_id = ?");
    bindings.push(request.headers.get("oai-authenticated-user-id") ?? "local-development");
  } else if (scopeParam === "unassigned") {
    filters.push("assigned_actor_id IS NULL");
  } else if (scopeParam === "overdue") {
    filters.push("status = 'open' AND last_message_direction = 'inbound' AND last_message_at <= ?");
    bindings.push(Date.now() - 30 * 60_000);
  }
  if (cursor) {
    filters.push(sortParam === "oldest"
      ? "(last_message_at > ? OR (last_message_at = ? AND source_id > ?))"
      : "(last_message_at < ? OR (last_message_at = ? AND source_id > ?))");
    bindings.push(cursor.timestamp, cursor.timestamp, cursor.key);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const countWhere = countFilters.length > 0 ? `WHERE ${countFilters.join(" AND ")}` : "";
  const order = sortParam === "oldest" ? "ASC" : "DESC";

  try {
    const [result, countResult] = await Promise.all([env.DB.prepare(
      `SELECT source_id AS sourceId, source_type AS sourceType,
              last_message_text AS lastMessageText,
              last_message_direction AS lastMessageDirection,
              last_message_at AS lastMessageAt, status,
              assigned_actor_id AS assignedActorId,
              assigned_actor_email AS assignedActorEmail,
              assigned_at AS assignedAt
       FROM line_conversations
       ${where}
       ORDER BY last_message_at ${order}, source_id ASC
       LIMIT ?`,
    ).bind(...bindings, limit + 1).all(), env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
       FROM line_conversations
       ${countWhere}`,
    ).bind(...countBindings).first<Record<string, unknown>>()]);
    const rows = result.results as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const conversations = rows.slice(0, limit);
    const last = conversations[conversations.length - 1] as { lastMessageAt?: unknown; sourceId?: unknown } | undefined;
    const nextCursor = hasMore && last
      ? makePageCursor(Number(last.lastMessageAt), String(last.sourceId))
      : null;
    const counts = {
      all: Number(countResult?.total ?? 0),
      open: Number(countResult?.open ?? 0),
      done: Number(countResult?.done ?? 0),
    };
    return json({ conversations, nextCursor, counts });
  } catch {
    return json({ conversations: [], nextCursor: null, error: "Database migration is pending" }, 503);
  }
}

function validLineSource(sourceId: string) {
  return /^[UCR][A-Za-z0-9_-]{10,}$/.test(sourceId);
}

async function handleConversationNotes(request: Request, env: Env, sourceId: string): Promise<Response> {
  if (!env.DB) return json({ notes: [], error: "Database is not configured" }, 503);
  if (!validLineSource(sourceId)) return json({ error: "Invalid LINE source" }, 400);

  if (request.method === "GET") {
    try {
      const result = await env.DB.prepare(
        `SELECT id, source_id AS sourceId, note_text AS noteText,
                actor_id AS actorId, actor_email AS actorEmail,
                created_at AS createdTimestamp
         FROM conversation_internal_notes
         WHERE source_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
      ).bind(sourceId).all();
      return json({ notes: result.results });
    } catch {
      return json({ notes: [], error: "Database migration is pending" }, 503);
    }
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
  if (!isSameOriginWrite(request)) return json({ error: "Invalid request origin" }, 403);
  let body: { note?: string };
  try {
    body = await request.json() as { note?: string };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const noteText = body.note?.trim() ?? "";
  if (!noteText || noteText.length > 3000) return json({ error: "Note must contain 1–3000 characters" }, 400);

  const id = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const createdTimestamp = Date.now();
  const actorId = request.headers.get("oai-authenticated-user-id") ?? "local-development";
  const actorEmail = request.headers.get("oai-authenticated-user-email");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO conversation_internal_notes
        (id, source_id, note_text, actor_id, actor_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, sourceId, noteText, actorId, actorEmail, createdTimestamp),
    env.DB.prepare(
      `INSERT INTO workspace_audit_events
        (id, occurred_at, actor_id, actor_email, action, case_id, detail)
       VALUES (?, ?, ?, ?, '新增內部備註', ?, ?)`,
    ).bind(auditId, createdTimestamp, actorId, actorEmail, `LIVE-${sourceId}`, "備註只供團隊查看，不會傳送到 LINE。"),
  ]);
  return json({ note: { id, sourceId, noteText, actorId, actorEmail, createdTimestamp } }, 201);
}

async function handleConversationAssignment(request: Request, env: Env, sourceId: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
  if (!isSameOriginWrite(request)) return json({ error: "Invalid request origin" }, 403);
  if (!env.DB) return json({ error: "Database is not configured" }, 503);
  if (!validLineSource(sourceId)) return json({ error: "Invalid LINE source" }, 400);
  let body: { action?: string };
  try {
    body = await request.json() as { action?: string };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (body.action !== "self" && body.action !== "unassign") return json({ error: "Invalid assignment action" }, 400);

  const actorId = request.headers.get("oai-authenticated-user-id") ?? "local-development";
  const actorEmail = request.headers.get("oai-authenticated-user-email");
  const occurredAt = Date.now();
  const auditId = crypto.randomUUID();
  const assignedActorId = body.action === "self" ? actorId : null;
  const assignedActorEmail = body.action === "self" ? actorEmail : null;
  const assignedAt = body.action === "self" ? occurredAt : null;
  const update = env.DB.prepare(
    `UPDATE line_conversations
     SET assigned_actor_id = ?, assigned_actor_email = ?, assigned_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE source_id = ?`,
  ).bind(assignedActorId, assignedActorEmail, assignedAt, sourceId);
  const auditInsert = env.DB.prepare(
    `INSERT INTO workspace_audit_events
      (id, occurred_at, actor_id, actor_email, action, case_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    auditId, occurredAt, actorId, actorEmail,
    body.action === "self" ? "接手對話" : "解除指派",
    `LIVE-${sourceId}`,
    body.action === "self" ? "對話已指派給目前使用者。" : "對話已回到未指派佇列。",
  );
  const [updateResult] = await env.DB.batch([update, auditInsert]);
  if (Number(updateResult.meta.changes ?? 0) < 1) return json({ error: "Conversation not found" }, 404);
  return json({ assignment: { assignedActorId, assignedActorEmail, assignedAt } });
}

async function handleLineConversationMessages(request: Request, env: Env, sourceId: string): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
  if (!env.DB) return json({ messages: [], nextCursor: null, error: "Database is not configured" }, 503);
  if (!validLineSource(sourceId)) return json({ error: "Invalid LINE source" }, 400);

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

async function handleWorkspaceKnowledge(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ rules: [], error: "Database is not configured" }, 503);
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "clinic" ? "clinic" : "retail";

  if (request.method === "GET") {
    try {
      const result = await env.DB.prepare(
        `SELECT id, mode, title, body,
                CAST(strftime('%s', created_at) AS INTEGER) * 1000 AS createdTimestamp,
                CAST(strftime('%s', updated_at) AS INTEGER) * 1000 AS updatedTimestamp
         FROM workspace_knowledge_rules
         WHERE mode = ? AND active = 1
         ORDER BY updated_at DESC, id ASC`,
      ).bind(mode).all();
      return json({ rules: result.results });
    } catch {
      return json({ rules: [], error: "Database migration is pending" }, 503);
    }
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
  if (!isSameOriginWrite(request)) return json({ error: "Invalid request origin" }, 403);
  let body: { mode?: string; title?: string; body?: string };
  try {
    body = await request.json() as { mode?: string; title?: string; body?: string };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const nextMode = body.mode === "clinic" ? "clinic" : body.mode === "retail" ? "retail" : "";
  const title = body.title?.trim() ?? "";
  const ruleBody = body.body?.trim() ?? "";
  if (!nextMode || title.length < 2 || title.length > 120 || ruleBody.length < 4 || ruleBody.length > 3000) {
    return json({ error: "Rule must include a valid mode, title, and 4–3000 character body" }, 400);
  }
  const actorId = request.headers.get("oai-authenticated-user-id") ?? "local-development";
  const actorEmail = request.headers.get("oai-authenticated-user-email");
  const id = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const occurredAt = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO workspace_knowledge_rules
        (id, mode, title, body, active, created_by, created_by_email)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).bind(id, nextMode, title, ruleBody, actorId, actorEmail),
    env.DB.prepare(
      `INSERT INTO workspace_audit_events
        (id, occurred_at, actor_id, actor_email, action, case_id, detail)
       VALUES (?, ?, ?, ?, '新增知識規則', ?, ?)`,
    ).bind(auditId, occurredAt, actorId, actorEmail, `KNOWLEDGE-${nextMode}`, title),
  ]);
  return json({ rule: { id, mode: nextMode, title, body: ruleBody, createdTimestamp: occurredAt, updatedTimestamp: occurredAt } }, 201);
}

async function handleWorkspaceAudit(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ events: [], error: "Database is not configured" }, 503);
  if (request.method === "GET") {
    const limit = pageLimit(request, 100, 200);
    try {
      const result = await env.DB.prepare(
        `SELECT id, occurred_at AS occurredAt, actor_id AS actorId,
                actor_email AS actorEmail, action, case_id AS caseId, detail
         FROM workspace_audit_events
         ORDER BY occurred_at DESC, id DESC
         LIMIT ?`,
      ).bind(limit).all();
      return json({ events: result.results });
    } catch {
      return json({ events: [], error: "Database migration is pending" }, 503);
    }
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
  if (!isSameOriginWrite(request)) return json({ error: "Invalid request origin" }, 403);
  let body: { action?: string; caseId?: string; detail?: string };
  try {
    body = await request.json() as { action?: string; caseId?: string; detail?: string };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const action = body.action?.trim() ?? "";
  const caseId = body.caseId?.trim() ?? "";
  const detail = body.detail?.trim() ?? "";
  if (!action || action.length > 120 || !caseId || caseId.length > 160 || !detail || detail.length > 2000) {
    return json({ error: "Invalid audit event" }, 400);
  }
  const id = crypto.randomUUID();
  const occurredAt = Date.now();
  const actorId = request.headers.get("oai-authenticated-user-id") ?? "local-development";
  const actorEmail = request.headers.get("oai-authenticated-user-email");
  await env.DB.prepare(
    `INSERT INTO workspace_audit_events
      (id, occurred_at, actor_id, actor_email, action, case_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, occurredAt, actorId, actorEmail, action, caseId, detail).run();
  return json({ event: { id, occurredAt, actorId, actorEmail, action, caseId, detail } }, 201);
}

type ConversationAnalysis = {
  sourceId: string;
  inputMessageAt: number;
  intent: string;
  urgency: string;
  risk: string;
  confidence: number;
  observation: string;
  rationale: string;
  draft: string;
  evidence: string[];
  engine: "openai" | "rules";
  model: string;
  status: string;
  updatedTimestamp: number;
};

async function handleConversationAnalysis(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
  if (!isSameOriginWrite(request)) return json({ error: "Invalid request origin" }, 403);
  if (!env.DB) return json({ error: "Database is not configured" }, 503);
  let body: { sourceId?: string };
  try {
    body = await request.json() as { sourceId?: string };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const sourceId = body.sourceId?.trim() ?? "";
  if (!/^[UCR][A-Za-z0-9_-]{10,}$/.test(sourceId)) return json({ error: "Invalid LINE source" }, 400);

  const conversation = await env.DB.prepare(
    `SELECT source_id AS sourceId, last_message_text AS lastMessageText,
            last_message_direction AS lastMessageDirection,
            last_message_at AS lastMessageAt, status
     FROM line_conversations WHERE source_id = ?`,
  ).bind(sourceId).first<{ sourceId: string; lastMessageText: string | null; lastMessageDirection: string; lastMessageAt: number; status: string }>();
  if (!conversation) return json({ error: "Conversation not found" }, 404);

  const existing = await readConversationAnalysis(env.DB, sourceId);
  const openAIConfigured = Boolean(env.OPENAI_API_KEY);
  if (existing && existing.inputMessageAt >= Number(conversation.lastMessageAt) && (!openAIConfigured || existing.engine === "openai")) {
    return json({ analysis: existing, cached: true, configured: openAIConfigured, engine: existing.engine });
  }

  const mode = env.LINE_WORKSPACE_MODE === "clinic" ? "clinic" : "retail";
  const [messagesResult, rulesResult] = await Promise.all([
    env.DB.prepare(
      `WITH conversation_messages AS (
         SELECT 'customer' AS speaker, message_text AS text, event_timestamp AS timestamp,
                webhook_event_id AS stable_id
         FROM line_webhook_events
         WHERE source_id = ? AND event_type = 'message' AND message_text IS NOT NULL
         UNION ALL
         SELECT 'staff' AS speaker, message_text AS text,
                COALESCE(CAST(strftime('%s', sent_at) AS INTEGER) * 1000,
                         CAST(strftime('%s', created_at) AS INTEGER) * 1000) AS timestamp,
                request_id AS stable_id
         FROM line_outbound_messages
         WHERE target_id = ? AND status = 'sent'
       )
       SELECT speaker, text, timestamp FROM conversation_messages
       ORDER BY timestamp DESC, stable_id DESC LIMIT 20`,
    ).bind(sourceId, sourceId).all(),
    env.DB.prepare(
      `SELECT title, body FROM workspace_knowledge_rules
       WHERE mode = ? AND active = 1
       ORDER BY updated_at DESC, id ASC LIMIT 30`,
    ).bind(mode).all(),
  ]);

  const messages = [...messagesResult.results].reverse() as AnalysisMessage[];
  const rules = rulesResult.results as AnalysisKnowledgeRule[];
  let model = "rules-v1";
  let engine: ConversationAnalysis["engine"] = "rules";
  let validated: RuleAnalysis = analyzeWithRules(mode, messages, rules);
  const actorId = request.headers.get("oai-authenticated-user-id") ?? "local-development";
  if (env.OPENAI_API_KEY) {
    try {
      const requestedModel = env.OPENAI_MODEL?.trim() || "gpt-5.4-mini";
      const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: requestedModel,
          store: false,
          reasoning: { effort: "low" },
          max_output_tokens: 1400,
          safety_identifier: await stableSafetyIdentifier(actorId),
          prompt_cache_key: `reply-ledger-${mode}-analysis-v1`,
          instructions: analysisInstructions(mode),
          input: JSON.stringify({ mode, conversation: messages, knowledge: rules }),
          text: {
            verbosity: "low",
            format: {
              type: "json_schema",
              name: "reply_ledger_analysis",
              strict: true,
              schema: analysisSchema(),
            },
          },
        }),
      });
      if (openAIResponse.ok) {
        const responseBody = await openAIResponse.json() as Record<string, unknown>;
        const outputText = extractOpenAIOutputText(responseBody);
        const parsed = JSON.parse(outputText) as Record<string, unknown>;
        const openAIAnalysis = validateAnalysis(parsed);
        if (openAIAnalysis) {
          validated = openAIAnalysis;
          model = requestedModel;
          engine = "openai";
        }
      }
    } catch {
      // The deterministic engine remains available when the optional provider is unavailable.
    }
  }

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO conversation_analyses
        (source_id, input_message_at, intent, urgency, risk, confidence,
         observation, rationale, draft, evidence_json, model, status, error_message, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', NULL, CURRENT_TIMESTAMP)
       ON CONFLICT(source_id) DO UPDATE SET
         input_message_at = excluded.input_message_at,
         intent = excluded.intent,
         urgency = excluded.urgency,
         risk = excluded.risk,
         confidence = excluded.confidence,
         observation = excluded.observation,
         rationale = excluded.rationale,
         draft = excluded.draft,
         evidence_json = excluded.evidence_json,
         model = excluded.model,
         status = excluded.status,
         error_message = NULL,
         updated_at = CURRENT_TIMESTAMP
       WHERE excluded.input_message_at >= conversation_analyses.input_message_at`,
    ).bind(
      sourceId, Number(conversation.lastMessageAt), validated.intent, validated.urgency,
      validated.risk, validated.confidence, validated.observation, validated.rationale,
      validated.draft, JSON.stringify(validated.evidence), model,
    ),
    env.DB.prepare(
      `INSERT INTO workspace_audit_events
        (id, occurred_at, actor_id, actor_email, action, case_id, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), now, actorId, request.headers.get("oai-authenticated-user-email"),
      engine === "openai" ? "AI 產生建議" : "規則引擎產生建議",
      `LIVE-${sourceId}`, `引擎 ${model}；引用 ${validated.evidence.length} 份根據。`,
    ),
  ]);
  const analysis: ConversationAnalysis = {
    sourceId,
    inputMessageAt: Number(conversation.lastMessageAt),
    ...validated,
    engine,
    model,
    status: "ready",
    updatedTimestamp: now,
  };
  return json({ analysis, cached: false, configured: openAIConfigured, engine });
}

async function readConversationAnalysis(db: D1Database, sourceId: string): Promise<ConversationAnalysis | null> {
  const row = await db.prepare(
    `SELECT source_id AS sourceId, input_message_at AS inputMessageAt,
            intent, urgency, risk, confidence, observation, rationale, draft,
            evidence_json AS evidenceJson, model, status,
            CAST(strftime('%s', updated_at) AS INTEGER) * 1000 AS updatedTimestamp
     FROM conversation_analyses WHERE source_id = ?`,
  ).bind(sourceId).first<Record<string, unknown>>();
  if (!row) return null;
  let evidence: string[] = [];
  try {
    const parsed = JSON.parse(String(row.evidenceJson ?? "[]"));
    if (Array.isArray(parsed)) evidence = parsed.filter((item): item is string => typeof item === "string").slice(0, 8);
  } catch {
    evidence = [];
  }
  return {
    sourceId: String(row.sourceId),
    inputMessageAt: Number(row.inputMessageAt),
    intent: String(row.intent),
    urgency: String(row.urgency),
    risk: String(row.risk),
    confidence: Number(row.confidence),
    observation: String(row.observation),
    rationale: String(row.rationale),
    draft: String(row.draft),
    evidence,
    engine: String(row.model).startsWith("rules-") ? "rules" : "openai",
    model: String(row.model),
    status: String(row.status),
    updatedTimestamp: Number(row.updatedTimestamp),
  };
}

function analysisInstructions(mode: "retail" | "clinic") {
  const domainPolicy = mode === "clinic"
    ? "Do not diagnose, calculate dosage, or reassure away urgent symptoms. Escalate medical risk to a qualified human."
    : "Do not invent price, stock, dimensions, compatibility, or installation cost. Ask for missing site details or photos before promising installation totals.";
  return `You are Reply Ledger, a Traditional Chinese customer-service observer. Analyze the supplied LINE conversation and knowledge rules. ${domainPolicy} Use only facts present in the conversation or knowledge list. Evidence entries must exactly match supplied knowledge titles; use an empty list when no rule applies. Draft a concise Traditional Chinese reply that is ready for human review but never claims it was sent. Describe uncertainty explicitly. Return only the structured output.`;
}

function analysisSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["intent", "urgency", "risk", "confidence", "observation", "rationale", "draft", "evidence"],
    properties: {
      intent: { type: "string", minLength: 1, maxLength: 60 },
      urgency: { type: "string", enum: ["低", "中", "高"] },
      risk: { type: "string", minLength: 1, maxLength: 120 },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
      observation: { type: "string", minLength: 1, maxLength: 500 },
      rationale: { type: "string", minLength: 1, maxLength: 700 },
      draft: { type: "string", minLength: 1, maxLength: 1800 },
      evidence: { type: "array", maxItems: 8, items: { type: "string", maxLength: 120 } },
    },
  };
}

function validateAnalysis(value: Record<string, unknown>) {
  const fields = ["intent", "urgency", "risk", "observation", "rationale", "draft"] as const;
  if (fields.some((field) => typeof value[field] !== "string" || !(value[field] as string).trim())) return null;
  const confidence = Number(value.confidence);
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) return null;
  if (!Array.isArray(value.evidence) || value.evidence.some((item) => typeof item !== "string")) return null;
  return {
    intent: String(value.intent).slice(0, 60),
    urgency: new Set(["低", "中", "高"]).has(String(value.urgency)) ? String(value.urgency) : "中",
    risk: String(value.risk).slice(0, 120),
    confidence,
    observation: String(value.observation).slice(0, 500),
    rationale: String(value.rationale).slice(0, 700),
    draft: String(value.draft).slice(0, 1800),
    evidence: (value.evidence as string[]).map((item) => item.slice(0, 120)).slice(0, 8),
  };
}

function extractOpenAIOutputText(body: Record<string, unknown>) {
  if (typeof body.output_text === "string") return body.output_text;
  const output = Array.isArray(body.output) ? body.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

async function stableSafetyIdentifier(actorId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(actorId));
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function handleLineSend(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
  if (!isSameOriginWrite(request)) return json({ error: "Invalid request origin" }, 403);
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

function isSameOriginWrite(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
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
