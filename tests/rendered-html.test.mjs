import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/", authenticated = true) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const headers = { accept: "text/html", host: "reply-ledger.example", "x-forwarded-proto": "https" };
  if (authenticated) {
    headers["oai-authenticated-user-id"] = "test-user";
    headers["oai-authenticated-user-email"] = "owner@example.com";
  }
  return worker.fetch(
    new Request(`https://reply-ledger.example${path}`, { headers }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders a public product page without exposing private LINE data", async () => {
  const response = await render("/", false);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Reply Ledger｜回覆帳簿/);
  assert.match(html, /AI 不替你說話/);
  assert.match(html, /登入工作台/);
  assert.match(html, /公開頁不載入任何真實 LINE 資料/);
  assert.match(html, /https:\/\/reply-ledger-tw\.ntumed301\.chatgpt\.site\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/);
});

test("server-renders the protected Reply Ledger workspace for an authenticated user", async () => {
  const response = await render("/app", true);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /每一句建議，都留下根據/);
  assert.match(html, /燈飾零售/);
  assert.match(html, /診所觀察員/);
  assert.match(html, /LINE 收件匣/);
  assert.match(html, /只有真人完成第二次確認後才會傳送/);
});

test("ships the tour and both guarded scenario sets", async () => {
  const [tour, data, client] = await Promise.all([
    readFile(new URL("../public/intro.html", import.meta.url), "utf8"),
    readFile(new URL("../app/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ReplyLedger.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(tour, /PRODUCT TOUR/);
  assert.match(tour, /900/);
  assert.match(data, /安裝費未知/);
  assert.match(data, /兒童用藥／不可推算/);
  assert.doesNotMatch(client, /localStorage/);
  assert.match(client, /轉交真人/);
  assert.match(client, /稽核紀錄/);
  assert.match(client, /\/api\/line\/send/);
  assert.match(client, /\/api\/line\/outbox/);
  assert.match(client, /\/api\/line\/conversations\?status=all&limit=30/);
  assert.match(client, /\/api\/workspace\/knowledge/);
  assert.match(client, /\/api\/workspace\/audit/);
  assert.match(client, /\/api\/ai\/analyze/);
  assert.match(client, /\/messages\?/);
  assert.match(client, /確認，現在傳送/);
  assert.match(client, /selected\.revision/);
  assert.match(client, /BREME 燈飾顧問/);
});

test("LINE webhook rejects spoofed requests and accepts a correctly signed verification request", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("line-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const secret = "test-channel-secret";
  const body = JSON.stringify({ destination: "U-test", events: [] });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const signature = Buffer.from(signatureBytes).toString("base64");
  const storedStatements = [];
  let persistence = Promise.resolve();
  const env = {
    DB: {
      prepare(sql) {
        return { bind(...args) { return { sql, args }; } };
      },
      async batch(statements) {
        storedStatements.push(...statements);
        return [];
      },
    },
    LINE_CHANNEL_SECRET: secret,
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const spoofed = await worker.fetch(new Request("https://reply-ledger.example/api/line/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": "invalid" },
    body,
  }), env, ctx);
  assert.equal(spoofed.status, 401);

  const verified = await worker.fetch(new Request("https://reply-ledger.example/api/line/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": signature },
    body,
  }), env, ctx);
  assert.equal(verified.status, 200);
  assert.deepEqual(await verified.json(), { ok: true });

  const eventBody = JSON.stringify({
    destination: "U-bot",
    events: [
      {
        type: "message",
        webhookEventId: "01TESTEVENT",
        timestamp: 1787152000000,
        deliveryContext: { isRedelivery: false },
        source: { type: "user", userId: "U1234567890" },
        message: { id: "999", type: "text", text: "真實測試訊息" },
      },
      {
        type: "message",
        webhookEventId: "01TESTIMAGE",
        timestamp: 1787152001000,
        deliveryContext: { isRedelivery: false },
        source: { type: "user", userId: "U1234567890" },
        message: { id: "1001", type: "image" },
      },
    ],
  });
  const eventSignatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(eventBody));
  const eventSignature = Buffer.from(eventSignatureBytes).toString("base64");
  const eventCtx = { waitUntil(promise) { persistence = promise; }, passThroughOnException() {} };
  const eventResponse = await worker.fetch(new Request("https://reply-ledger.example/api/line/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": eventSignature },
    body: eventBody,
  }), env, eventCtx);
  assert.equal(eventResponse.status, 200);
  await persistence;
  assert.equal(storedStatements.length, 4);
  assert.deepEqual(storedStatements[0].args, [
    "01TESTEVENT", "U-bot", "message", "user", "U1234567890",
    1787152000000, 0, "text", "999", "真實測試訊息",
  ]);
  assert.deepEqual(storedStatements[1].args, [
    "U1234567890", "user", "真實測試訊息", 1787152000000,
  ]);
  assert.deepEqual(storedStatements[3].args, [
    "U1234567890", "user", "［圖片］", 1787152001000,
  ]);
});

test("LINE webhook reports persistence failures so LINE can redeliver", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("line-persistence-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const secret = "test-channel-secret";
  const body = JSON.stringify({
    destination: "U-bot",
    events: [{
      type: "message",
      webhookEventId: "01FAILEDSTORE",
      timestamp: 1787152000000,
      source: { type: "user", userId: "U1234567890" },
      message: { id: "1000", type: "text", text: "必須可靠保存" },
    }],
  });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))).toString("base64");
  const env = {
    DB: {
      prepare(sql) { return { bind(...args) { return { sql, args }; } }; },
      async batch() { throw new Error("D1 unavailable"); },
    },
    LINE_CHANNEL_SECRET: secret,
  };
  const response = await worker.fetch(new Request("https://reply-ledger.example/api/line/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": signature },
    body,
  }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Event persistence failed" });
});

test("LINE conversations and message history use stable cursor pagination", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("line-pagination-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const calls = [];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            calls.push({ sql, args });
            return {
              async all() {
                if (sql.includes("FROM line_conversations")) {
                  return { results: [
                    { sourceId: "U1234567890", sourceType: "user", lastMessageText: "最新訊息", lastMessageDirection: "inbound", lastMessageAt: 2000, status: "open" },
                    { sourceId: "U0987654321", sourceType: "user", lastMessageText: "較舊訊息", lastMessageDirection: "outbound", lastMessageAt: 1000, status: "done" },
                  ] };
                }
                if (sql.includes("WITH conversation_messages")) {
                  return { results: [
                    { direction: "inbound", messageKey: "IN-2", messageText: "第二則", messageTimestamp: 2000, status: "received" },
                    { direction: "outbound", messageKey: "OUT-1", messageText: "第一則回覆", messageTimestamp: 1000, status: "sent" },
                  ] };
                }
                return { results: [] };
              },
            };
          },
        };
      },
    },
  };
  const headers = { "oai-authenticated-user-id": "owner-1" };

  const conversationsResponse = await worker.fetch(new Request(
    "https://reply-ledger.example/api/line/conversations?status=all&limit=1",
    { headers },
  ), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(conversationsResponse.status, 200);
  const conversations = await conversationsResponse.json();
  assert.equal(conversations.conversations.length, 1);
  assert.equal(conversations.nextCursor, "2000:U1234567890");

  const messagesResponse = await worker.fetch(new Request(
    "https://reply-ledger.example/api/line/conversations/U1234567890/messages?limit=1",
    { headers },
  ), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(messagesResponse.status, 200);
  const messages = await messagesResponse.json();
  assert.equal(messages.messages.length, 1);
  assert.equal(messages.nextCursor, "2000:IN-2");
  assert.ok(calls.some((call) => call.sql.includes("ORDER BY last_message_at DESC, source_id ASC")));
  assert.ok(calls.some((call) => call.sql.includes("ORDER BY messageTimestamp DESC, messageKey DESC")));
});

function createOutboundDb(initialRows = []) {
  const rows = new Map(initialRows.map((row) => [row.requestId, { ...row }]));
  return {
    rows,
    async batch(statements) {
      for (const { sql, args } of statements) {
        if (sql.includes("SET status = 'sent'")) {
          const [lineRequestId, requestId] = args;
          const row = rows.get(requestId);
          if (row) Object.assign(row, { status: "sent", lineRequestId, sentTimestamp: Date.now(), errorMessage: null });
        }
      }
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
    prepare(sql) {
      return {
        bind(...args) {
          return {
            sql,
            args,
            async first() {
              if (!sql.includes("FROM line_outbound_messages WHERE request_id")) return null;
              const row = rows.get(args[0]);
              return row ? { targetId: row.targetId, messageText: row.messageText, status: row.status } : null;
            },
            async run() {
              if (sql.includes("INSERT INTO line_outbound_messages")) {
                const [requestId, targetId, messageText, actorId, actorEmail] = args;
                rows.set(requestId, { requestId, targetId, messageText, actorId, actorEmail, status: "pending", createdTimestamp: Date.now(), sentTimestamp: null, lineRequestId: null, errorMessage: null });
              } else if (sql.includes("SET status = 'pending'")) {
                const row = rows.get(args[0]);
                if (row) Object.assign(row, { status: "pending", errorMessage: null });
              } else if (sql.includes("SET status = 'sent'")) {
                const [lineRequestId, requestId] = args;
                const row = rows.get(requestId);
                if (row) Object.assign(row, { status: "sent", lineRequestId, sentTimestamp: Date.now(), errorMessage: null });
              } else if (sql.includes("UPDATE line_outbound_messages SET status = ?")) {
                const [status, errorMessage, requestId] = args;
                const row = rows.get(requestId);
                if (row) Object.assign(row, { status, errorMessage });
              }
              return { meta: { changes: 1 } };
            },
            async all() {
              if (!sql.includes("FROM line_outbound_messages")) return { results: [] };
              return { results: [...rows.values()].slice(0, Number(args[0] ?? 50)) };
            },
          };
        },
      };
    },
  };
}

test("LINE send is authenticated, branded, durable, and idempotent", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("line-send-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const db = createOutboundDb();
  const env = { DB: db, LINE_CHANNEL_ACCESS_TOKEN: "test-token", LINE_WORKSPACE_MODE: "retail" };
  const requestId = "123e4567-e89b-42d3-a456-426614174000";
  const requestBody = { to: "U1234567890", text: "這是一則經過真人確認的回覆。", requestId };

  const unauthorized = await worker.fetch(new Request("https://reply-ledger.example/api/line/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(unauthorized.status, 401);

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response("", { status: 200, headers: { "x-line-request-id": "LINE-REQ-1" } });
  };
  try {
    const response = await worker.fetch(new Request("https://reply-ledger.example/api/line/send", {
      method: "POST",
      headers: { "content-type": "application/json", "oai-authenticated-user-id": "owner-1", "oai-authenticated-user-email": "owner@example.com" },
      body: JSON.stringify(requestBody),
    }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).format, "flex");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.messages[0].type, "flex");
    assert.equal(calls[0].body.messages[0].contents.header.contents[1].text, "BREME 燈飾顧問");
    assert.equal(calls[0].body.messages[0].contents.body.contents[0].text, requestBody.text);
    assert.equal(db.rows.get(requestId).status, "sent");

    const duplicate = await worker.fetch(new Request("https://reply-ledger.example/api/line/send", {
      method: "POST",
      headers: { "content-type": "application/json", "oai-authenticated-user-id": "owner-1" },
      body: JSON.stringify(requestBody),
    }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(duplicate.status, 409);
    assert.equal(calls.length, 1);

    const outbox = await worker.fetch(new Request("https://reply-ledger.example/api/line/outbox", {
      headers: { "oai-authenticated-user-id": "owner-1" },
    }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(outbox.status, 200);
    assert.equal((await outbox.json()).messages[0].status, "sent");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a retry uses the same LINE retry key and treats LINE 409 as already accepted", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("line-retry-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const requestId = "223e4567-e89b-42d3-a456-426614174000";
  const row = { requestId, targetId: "U1234567890", messageText: "安全重試", actorId: "owner-1", actorEmail: null, status: "failed", createdTimestamp: Date.now(), sentTimestamp: null, lineRequestId: null, errorMessage: "timeout" };
  const db = createOutboundDb([row]);
  const env = { DB: db, LINE_CHANNEL_ACCESS_TOKEN: "test-token" };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers["x-line-retry-key"], requestId);
    return new Response("", { status: 409, headers: { "x-line-request-id": "LINE-RETRY-1" } });
  };
  try {
    const response = await worker.fetch(new Request("https://reply-ledger.example/api/line/send", {
      method: "POST",
      headers: { "content-type": "application/json", "oai-authenticated-user-id": "owner-1" },
      body: JSON.stringify({ to: row.targetId, text: row.messageText, requestId }),
    }), env, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).retried, true);
    assert.equal(db.rows.get(requestId).status, "sent");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createAnalysisDb() {
  const batches = [];
  return {
    batches,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            sql,
            args,
            async first() {
              if (sql.includes("FROM line_conversations")) {
                return { sourceId: "U1234567890", lastMessageText: "L-42 含安裝多少？", lastMessageDirection: "inbound", lastMessageAt: 1787152000000, status: "open" };
              }
              if (sql.includes("FROM conversation_analyses")) return null;
              return null;
            },
            async all() {
              if (sql.includes("WITH conversation_messages")) {
                return { results: [{ speaker: "customer", text: "L-42 含安裝多少？", timestamp: 1787152000000 }] };
              }
              if (sql.includes("FROM workspace_knowledge_rules")) {
                return { results: [{ title: "2026 零售價目表 · L-42", body: "燈具售價 NT$8,600；不含安裝。" }] };
              }
              return { results: [] };
            },
          };
        },
      };
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
}

test("AI analysis uses structured Responses output and only stores a human-review draft", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("ai-analysis-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const db = createAnalysisDb();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return Response.json({
      output_text: JSON.stringify({
        intent: "商品報價與安裝詢問",
        urgency: "中",
        risk: "安裝費未知",
        confidence: 91,
        observation: "客戶詢問 L-42 與安裝總價。",
        rationale: "價目表只有燈具售價，沒有現場條件。",
        draft: "L-42 燈具售價為 NT$8,600；安裝費需確認現場出線與固定方式，方便提供照片嗎？",
        evidence: ["2026 零售價目表 · L-42"],
      }),
    });
  };
  try {
    const response = await worker.fetch(new Request("https://reply-ledger.example/api/ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://reply-ledger.example", "oai-authenticated-user-id": "owner-1" },
      body: JSON.stringify({ sourceId: "U1234567890" }),
    }), { DB: db, OPENAI_API_KEY: "test-openai-key", OPENAI_MODEL: "gpt-5.4-mini", LINE_WORKSPACE_MODE: "retail" }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.analysis.confidence, 91);
    assert.equal(result.analysis.status, "ready");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
    assert.equal(calls[0].body.store, false);
    assert.equal(calls[0].body.text.format.type, "json_schema");
    assert.equal(calls[0].body.model, "gpt-5.4-mini");
    assert.equal(db.batches.length, 1);
    assert.equal(db.batches[0].length, 2);
    assert.ok(db.batches[0][0].sql.includes("conversation_analyses"));
    assert.ok(db.batches[0][1].sql.includes("workspace_audit_events"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI analysis fails closed when no server-side OpenAI key is configured", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("ai-unconfigured-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const db = createAnalysisDb();
  const response = await worker.fetch(new Request("https://reply-ledger.example/api/ai/analyze", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://reply-ledger.example", "oai-authenticated-user-id": "owner-1" },
    body: JSON.stringify({ sourceId: "U1234567890" }),
  }), { DB: db }, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "OpenAI analysis is not configured", configured: false });
  assert.equal(db.batches.length, 0);
});
