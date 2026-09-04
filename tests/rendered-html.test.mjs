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
  assert.match(html, /回得快/);
  assert.match(html, /申請 14 天試用/);
  assert.match(html, /預約 Demo/);
  assert.match(html, /產品驗證案例/);
  assert.match(html, /reply-ledger-demo-3min\.mp4/);
  assert.match(html, /公開頁不載入任何真實 LINE 資料/);
  assert.match(html, /https:\/\/reply-ledger-tw\.ntumed301\.chatgpt\.site\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/);
});

test("public trial and demo applications are validated, stored, and bot-filtered", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("lead-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const inserted = [];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() { return null; },
              async run() { inserted.push({ sql, args }); return { meta: { changes: 1 } }; },
            };
          },
        };
      },
    },
  };
  const headers = { "content-type": "application/json", origin: "https://reply-ledger.example" };
  const response = await worker.fetch(new Request("https://reply-ledger.example/api/leads", {
    method: "POST",
    headers,
    body: JSON.stringify({
      requestType: "trial",
      companyName: "光序燈飾",
      contactName: "陳店長",
      email: "owner@example.com",
      phoneOrLine: "@lighting",
      monthlyVolume: "300-1000",
      note: "想先驗證報價流程",
    }),
  }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 201);
  assert.equal(inserted.length, 1);
  assert.match(inserted[0].sql, /INSERT INTO sales_leads/);
  assert.equal(inserted[0].args[1], "trial");
  assert.equal(inserted[0].args[4], "owner@example.com");

  const invalid = await worker.fetch(new Request("https://reply-ledger.example/api/leads", {
    method: "POST",
    headers,
    body: JSON.stringify({ requestType: "demo", companyName: "A", contactName: "B", email: "bad" }),
  }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(invalid.status, 400);

  const bot = await worker.fetch(new Request("https://reply-ledger.example/api/leads", {
    method: "POST",
    headers,
    body: JSON.stringify({ website: "https://spam.example" }),
  }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(bot.status, 200);
  assert.equal(inserted.length, 1);
});

test("server-renders the protected Reply Ledger workspace for an authenticated user", async () => {
  const response = await render("/app", true);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /真人覆核客服台/);
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
  assert.match(client, /由我接手/);
  assert.match(client, /內部備註/);
  assert.match(client, /稽核紀錄/);
  assert.match(client, /\/api\/workspace\/send/);
  assert.match(client, /\/api\/workspace\/outbox/);
  assert.match(client, /\/api\/workspace\/conversations\?/);
  assert.match(client, /再載入 40 則對話/);
  assert.match(client, /跳到最新/);
  assert.match(client, /\/api\/workspace\/knowledge/);
  assert.match(client, /\/api\/workspace\/audit/);
  assert.match(client, /\/api\/ai\/analyze/);
  assert.match(client, /\/messages\?/);
  assert.match(client, /確認，現在傳送/);
  assert.match(client, /selected\.revision/);
  assert.match(client, /回覆助手/);
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
              async first() {
                if (sql.includes("COUNT(*) AS total")) return { total: 2, open: 1, done: 1 };
                return null;
              },
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
  assert.deepEqual(conversations.counts, { all: 2, open: 1, done: 1 });

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

test("a high-volume queue stays searchable and paginated instead of rendering every conversation", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("line-volume-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const calls = [];
  const rows = Array.from({ length: 41 }, (_, index) => ({
    sourceId: `U${String(index).padStart(10, "0")}`,
    sourceType: "user",
    lastMessageText: `報價詢問 ${index + 1}`,
    lastMessageDirection: "inbound",
    lastMessageAt: 1000 + index,
    status: "open",
  }));
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            calls.push({ sql, args });
            return {
              async first() {
                if (sql.includes("COUNT(*) AS total")) return { total: 240, open: 180, done: 60 };
                return null;
              },
              async all() { return { results: rows }; },
            };
          },
        };
      },
    },
  };
  const response = await worker.fetch(new Request(
    "https://reply-ledger.example/api/line/conversations?status=open&sort=oldest&q=%E5%A0%B1%E5%83%B9&limit=40",
    { headers: { "oai-authenticated-user-id": "owner-1" } },
  ), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.conversations.length, 40);
  assert.equal(body.nextCursor, "1039:U0000000039");
  assert.deepEqual(body.counts, { all: 240, open: 180, done: 60 });
  assert.ok(calls.some((call) => call.sql.includes("ORDER BY last_message_at ASC, source_id ASC")));
  assert.ok(calls.some((call) => call.args.includes("%報價%") && call.args.includes("open")));
});

test("conversation assignment and internal notes persist with an audit trail", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("conversation-collaboration-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const statements = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          const statement = {
            sql,
            args,
            async all() { return { results: [] }; },
          };
          statements.push(statement);
          return statement;
        },
      };
    },
    async batch(items) {
      return items.map(() => ({ meta: { changes: 1 } }));
    },
  };
  const headers = {
    "content-type": "application/json",
    "oai-authenticated-user-id": "owner-1",
    "oai-authenticated-user-email": "owner@example.com",
    origin: "https://reply-ledger.example",
  };

  const assignmentResponse = await worker.fetch(new Request(
    "https://reply-ledger.example/api/line/conversations/U1234567890/assignment",
    { method: "POST", headers, body: JSON.stringify({ action: "self" }) },
  ), { DB: db }, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(assignmentResponse.status, 200);
  assert.equal((await assignmentResponse.json()).assignment.assignedActorEmail, "owner@example.com");

  const noteResponse = await worker.fetch(new Request(
    "https://reply-ledger.example/api/line/conversations/U1234567890/notes",
    { method: "POST", headers, body: JSON.stringify({ note: "明天回電確認安裝高度。" }) },
  ), { DB: db }, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(noteResponse.status, 201);
  assert.equal((await noteResponse.json()).note.noteText, "明天回電確認安裝高度。");
  assert.ok(statements.some((statement) => statement.sql.includes("UPDATE line_conversations")));
  assert.ok(statements.some((statement) => statement.sql.includes("INSERT INTO conversation_internal_notes")));
  assert.ok(statements.filter((statement) => statement.sql.includes("INSERT INTO workspace_audit_events")).length >= 2);
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

function createAnalysisDb({ text = "L-42 含安裝多少？", rules = [{ title: "2026 零售價目表 · L-42", body: "燈具售價 NT$8,600；不含安裝。" }] } = {}) {
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
                return { sourceId: "U1234567890", lastMessageText: text, lastMessageDirection: "inbound", lastMessageAt: 1787152000000, status: "open" };
              }
              if (sql.includes("FROM conversation_analyses")) return null;
              return null;
            },
            async all() {
              if (sql.includes("WITH conversation_messages")) {
                return { results: [{ speaker: "customer", text, timestamp: 1787152000000 }] };
              }
              if (sql.includes("FROM workspace_knowledge_rules")) {
                return { results: rules };
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
    assert.equal(result.analysis.engine, "openai");
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

test("Rules v1 analyzes and persists when no server-side OpenAI key is configured", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("ai-unconfigured-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const db = createAnalysisDb();
  const response = await worker.fetch(new Request("https://reply-ledger.example/api/ai/analyze", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://reply-ledger.example", "oai-authenticated-user-id": "owner-1" },
    body: JSON.stringify({ sourceId: "U1234567890" }),
  }), { DB: db }, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.configured, false);
  assert.equal(result.engine, "rules");
  assert.equal(result.analysis.engine, "rules");
  assert.equal(result.analysis.model, "rules-v1");
  assert.match(result.analysis.draft, /NT\$8,600/);
  assert.match(result.analysis.draft, /安裝費.*確認/);
  assert.equal(db.batches.length, 1);
});

test("an OpenAI provider failure falls back to Rules v1 without losing the draft", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("ai-fallback-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const db = createAnalysisDb();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("provider unavailable", { status: 503 });
  try {
    const response = await worker.fetch(new Request("https://reply-ledger.example/api/ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://reply-ledger.example", "oai-authenticated-user-id": "owner-1" },
      body: JSON.stringify({ sourceId: "U1234567890" }),
    }), { DB: db, OPENAI_API_KEY: "test-openai-key", LINE_WORKSPACE_MODE: "retail" }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.engine, "rules");
    assert.equal(result.analysis.model, "rules-v1");
    assert.equal(db.batches.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Rules v1 keeps 20 retail and clinic scenarios within the safety boundaries", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("rules-fixtures-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const retailRules = [
    { title: "2026 零售價目表 · L-42", body: "L-42 吊燈售價 NT$8,600；不含安裝。" },
    { title: "餐桌吊燈選型手冊", body: "餐桌燈常見色溫 2700–3000K；仍需依空間確認。" },
    { title: "安裝報價規則 · 現場確認", body: "未取得出線位置、天花板與固定點照片前，不提供安裝總價。" },
  ];
  const clinicRules = [
    { title: "緊急徵象 · 立即轉介", body: "呼吸困難或意識改變應立即轉介急診。" },
    { title: "用藥安全 · 不推算劑量", body: "不得依聊天內容計算個別用藥劑量。" },
    { title: "症狀觀察 · 不代替診斷", body: "訊息回覆不得取代醫師診斷。" },
  ];
  const fixtures = [
    { mode: "retail", text: "L-42 多少錢？", intent: /商品報價/, draft: /NT\$8,600/ },
    { mode: "retail", text: "L-42 含安裝多少？", intent: /商品與安裝報價/, draft: /安裝費.*確認/ },
    { mode: "retail", text: "這個吊燈要怎麼安裝在天花板？", intent: /安裝條件確認/, draft: /現場照片/ },
    { mode: "retail", text: "現在有現貨嗎？", intent: /庫存、交期或配送/, draft: /不先猜測現貨/ },
    { mode: "retail", text: "寄到高雄大概要多久？", intent: /庫存、交期或配送/, draft: /配送縣市/ },
    { mode: "retail", text: "燈突然不亮了，可以維修嗎？", intent: /售後維修/, draft: /真人客服/ },
    { mode: "retail", text: "收到就是破損的，我要退款", intent: /客訴與退換貨/, draft: /退換貨流程/ },
    { mode: "retail", text: "燈座在冒煙還有燒焦味", intent: /電氣安全事件/, urgency: "高", draft: /停止使用/ },
    { mode: "retail", text: "餐桌上想裝吊燈，推薦哪一款？", intent: /燈具選購/, draft: /天花板高度/ },
    { mode: "retail", text: "客廳色溫應該怎麼選？", intent: /燈具選購/, draft: /色溫/ },
    { mode: "retail", text: "你好", intent: /資訊不足/, maxConfidence: 50, draft: /想詢問/ },
    { mode: "retail", text: "多少錢？", intent: /商品報價/, draft: /完整燈具型號/, excludes: /NT\$/ },
    { mode: "clinic", text: "我喘不過氣而且嘴唇發紫", intent: /緊急症狀轉介/, urgency: "高", draft: /119/ },
    { mode: "clinic", text: "家人突然昏倒、意識不清", intent: /緊急症狀轉介/, urgency: "高", draft: /急診/ },
    { mode: "clinic", text: "小孩這個藥要吃多少劑量？", intent: /用藥與劑量詢問/, draft: /不要自行增減藥量/ },
    { mode: "clinic", text: "退燒藥一次要喝幾cc？", intent: /用藥與劑量詢問/, draft: /不能.*推算/ },
    { mode: "clinic", text: "發燒咳嗽是不是流感？", intent: /症狀與診斷詢問/, draft: /無法安全判斷診斷/ },
    { mode: "clinic", text: "身上突然出紅疹，嚴重嗎？", intent: /症狀與診斷詢問/, draft: /醫療人員/ },
    { mode: "clinic", text: "我想預約下週門診", intent: /掛號與門診資訊/, draft: /希望的日期/ },
    { mode: "clinic", text: "診所地址在哪？營業到幾點？", intent: /掛號與門診資訊/, draft: /門診時間/ },
  ];
  assert.equal(fixtures.length, 20);
  for (const [index, fixture] of fixtures.entries()) {
    const db = createAnalysisDb({ text: fixture.text, rules: fixture.mode === "clinic" ? clinicRules : retailRules });
    const response = await worker.fetch(new Request("https://reply-ledger.example/api/ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://reply-ledger.example", "oai-authenticated-user-id": `fixture-${index}` },
      body: JSON.stringify({ sourceId: "U1234567890" }),
    }), { DB: db, LINE_WORKSPACE_MODE: fixture.mode }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200, fixture.text);
    const { analysis } = await response.json();
    assert.match(analysis.intent, fixture.intent, fixture.text);
    if (fixture.urgency) assert.equal(analysis.urgency, fixture.urgency, fixture.text);
    assert.match(analysis.draft, fixture.draft, fixture.text);
    if (fixture.excludes) assert.doesNotMatch(analysis.draft, fixture.excludes, fixture.text);
    if (fixture.maxConfidence) assert.ok(analysis.confidence <= fixture.maxConfidence, fixture.text);
    assert.equal(analysis.engine, "rules", fixture.text);
  }
});
