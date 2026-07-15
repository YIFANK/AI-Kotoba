import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stripRepeatedSpeakerPrefix } from "../public/ai-kotoba-web/js/services.js";

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

test("removes a duplicated speaker label from dialogue and furigana", () => {
  assert.equal(stripRepeatedSpeakerPrefix("患者[かんじゃ]、3日前[みっかまえ]から熱[ねつ]があります。", "患者"), "3日前[みっかまえ]から熱[ねつ]があります。");
  assert.equal(stripRepeatedSpeakerPrefix("医者：どうしましたか。", "医者"), "どうしましたか。");
  assert.equal(stripRepeatedSpeakerPrefix("患者さんは熱がありますか。", "医者"), "患者さんは熱がありますか。");
});

test("ships the original UI with account, playback, and push-to-talk controls", async () => {
  const [html, integration, services, realtime, realtimeRoute] = await Promise.all([
    readFile(new URL("../public/AI_kotoba_newUI/AI-Kotoba.dc.html", import.meta.url), "utf8"),
    readFile(new URL("../public/AI_kotoba_newUI/integration.js", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-kotoba-web/js/services.js", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-kotoba-web/js/realtime.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/realtime/session/route.ts", import.meta.url), "utf8"),
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
  assert.match(html, /aria-label="按住说话，松开发送"/);
  assert.match(html, /最近通话/);
  assert.match(html, /结束并保存/);
  assert.match(integration, /function saveTutorSession/);
  assert.match(integration, /db\.saveTutorSession/);
  assert.match(realtime, /turn_detection:\s*null/);
  assert.match(realtime, /input_audio_buffer\.clear/);
  assert.match(realtime, /input_audio_buffer\.commit/);
  assert.match(realtime, /output_audio_buffer\.clear/);
  assert.match(realtime, /response\.cancel/);
  assert.match(realtime, /retention_ratio:\s*0\.8/);
  assert.match(realtime, /session\.update', session: \{ instructions \}/);
  assert.doesNotMatch(realtime, /response:\s*\{\s*instructions:/);
  assert.match(realtimeRoute, /turn_detection:\s*null/);
  assert.match(services, /英語は絶対に使用しない/);
  assert.doesNotMatch(services, /各ターンは「短い日本語の反応/);
});
