import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("redirects the public root to the existing AI-Kotoba HTML UI", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /redirect\("\/AI_kotoba_newUI\/AI-Kotoba\.dc\.html"\)/);
});

test("keeps anonymous visitors in demo mode", async () => {
  const accountRoute = await readFile(new URL("../app/api/account/route.ts", import.meta.url), "utf8");
  assert.match(accountRoute, /authenticated:\s*false/);
  assert.match(accountRoute, /signin-with-chatgpt/);
  assert.match(accountRoute, /getRequestUser\(request\)/);
});

test("ships the original UI with account and playback-rate controls", async () => {
  const [html, integration, services, realtime] = await Promise.all([
    readFile(new URL("../public/AI_kotoba_newUI/AI-Kotoba.dc.html", import.meta.url), "utf8"),
    readFile(new URL("../public/AI_kotoba_newUI/integration.js", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-kotoba-web/js/services.js", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-kotoba-web/js/realtime.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="account-pill"/);
  assert.match(html, /会话朗读语速/);
  assert.match(html, /data-dir="blue"/);
  assert.match(html, />蓝白<\/button>/);
  assert.match(html, /ai-kotoba-palette/);
  assert.match(html, /class="word-float card elev-lg"/);
  assert.match(html, /tokenPopoverPosition/);
  assert.match(html, /aria-label="关闭生词窗口"/);
  assert.match(integration, /\/api\/account/);
  assert.match(integration, /playbackRate/);
  assert.match(html, /双语入门（推荐 N5–N4）/);
  assert.match(integration, /setTutorStyle/);
  assert.match(services, /二言語モード/);
  assert.match(services, /Do not translate every sentence/);
  assert.match(integration, /teachingStyle === 'bilingual' \? 'auto' : 'ja'/);
  assert.match(realtime, /inputLanguage !== 'auto'/);
});
