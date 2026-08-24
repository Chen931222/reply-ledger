import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("https://reply-ledger.example/", { headers: { accept: "text/html", host: "reply-ledger.example", "x-forwarded-proto": "https", "oai-authenticated-user-id": "test-user", "oai-authenticated-user-email": "owner@example.com" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Reply Ledger product surface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Reply Ledger｜回覆帳簿/);
  assert.match(html, /每一句建議，都留下根據/);
  assert.match(html, /燈飾零售/);
  assert.match(html, /診所觀察員/);
  assert.match(html, /LINE 收件匣/);
  assert.match(html, /目前顯示 Demo 資料/);
  assert.match(html, /只有真人完成第二次確認後才會傳送/);
  assert.match(html, /https:\/\/reply-ledger\.example\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/);
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
  assert.match(client, /localStorage/);
  assert.match(client, /轉交真人/);
  assert.match(client, /稽核紀錄/);
  assert.match(client, /\/api\/line\/send/);
  assert.match(client, /\/api\/line\/outbox/);
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
    events: [{
      type: "message",
      webhookEventId: "01TESTEVENT",
      timestamp: 1787152000000,
      deliveryContext: { isRedelivery: false },
      source: { type: "user", userId: "U1234567890" },
      message: { id: "999", type: "text", text: "真實測試訊息" },
    }],
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
  assert.equal(storedStatements.length, 1);
  assert.deepEqual(storedStatements[0].args, [
    "01TESTEVENT", "U-bot", "message", "user", "U1234567890",
    1787152000000, 0, "text", "999", "真實測試訊息",
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

function createOutboundDb(initialRows = []) {
  const rows = new Map(initialRows.map((row) => [row.requestId, { ...row }]));
  return {
    rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
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
