import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("https://reply-ledger.example/", { headers: { accept: "text/html", host: "reply-ledger.example", "x-forwarded-proto": "https" } }),
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
  assert.match(html, /AI 不會自行送出/);
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
});
