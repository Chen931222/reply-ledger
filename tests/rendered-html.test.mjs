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
  assert.match(client, /確認，現在傳送/);
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
