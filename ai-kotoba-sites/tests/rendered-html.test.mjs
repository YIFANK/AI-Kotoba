import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isCompleteGrammarLesson,
  normalizeGrammarLesson,
  stripRepeatedSpeakerPrefix,
} from "../public/ai-kotoba-web/js/services.js";

test("redirects the public root to the existing AI-Kotoba HTML UI", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /redirect\("\/AI_kotoba_newUI\/AI-Kotoba\.dc\.html"\)/);
});

test("keeps anonymous visitors in demo mode", async () => {
  const accountRoute = await readFile(new URL("../app/api/account/route.ts", import.meta.url), "utf8");
  assert.match(accountRoute, /authenticated:\s*false/);
  assert.match(accountRoute, /signin-with-chatgpt/);
  assert.match(accountRoute, /getRequestUser\(request\)/);
  assert.match(accountRoute, /isAdminUser\(user\)/);
});

test("removes a duplicated speaker label from dialogue and furigana", () => {
  assert.equal(stripRepeatedSpeakerPrefix("患者[かんじゃ]、3日前[みっかまえ]から熱[ねつ]があります。", "患者"), "3日前[みっかまえ]から熱[ねつ]があります。");
  assert.equal(stripRepeatedSpeakerPrefix("医者：どうしましたか。", "医者"), "どうしましたか。");
  assert.equal(stripRepeatedSpeakerPrefix("患者さんは熱がありますか。", "医者"), "患者さんは熱がありますか。");
});

test("ships the original UI with account, playback, and push-to-talk controls", async () => {
  const [html, integration, services, storage, realtime, realtimeRoute] = await Promise.all([
    readFile(new URL("../public/AI_kotoba_newUI/AI-Kotoba.dc.html", import.meta.url), "utf8"),
    readFile(new URL("../public/AI_kotoba_newUI/integration.js", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-kotoba-web/js/services.js", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-kotoba-web/js/storage.js", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-kotoba-web/js/realtime.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/realtime/session/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="account-pill"/);
  assert.match(html, /dialogueSpeedLabel:'会话朗读语速'/);
  assert.match(html, /data-dir="blue"/);
  assert.match(html, /\{\{ ui\.blue \}\}<\/button>/);
  assert.match(html, /ai-kotoba-palette/);
  assert.match(html, /class="word-float card elev-lg"/);
  assert.match(html, /tokenPopoverPosition/);
  assert.match(html, /aria-label="\{\{ ui\.closeVocab \}\}"/);
  assert.match(integration, /\/api\/account/);
  assert.match(integration, /playbackRate/);
  assert.match(html, /双语入门（推荐 N5–N4）/);
  assert.match(integration, /setTutorStyle/);
  assert.match(services, /二言語モード/);
  assert.match(services, /Do not translate every sentence/);
  assert.match(integration, /teachingStyle === 'bilingual' \? 'auto' : 'ja'/);
  assert.match(realtime, /inputLanguage !== 'auto'/);
  assert.match(html, /aria-label="\{\{ ui\.holdTalkLabel \}\}"/);
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
  assert.match(realtime, /REALTIME_MAX_DURATION_MS = 12 \* 60 \* 1000/);
  assert.match(realtime, /onTimeLimit/);
  assert.match(realtime, /requestSessionReview/);
  assert.match(realtime, /name:\s*'submit_session_review'/);
  assert.match(realtime, /conversation:\s*'none'/);
  assert.match(realtime, /metadata:\s*\{\s*topic:\s*'session_review'\s*\}/);
  assert.match(realtime, /output_modalities:\s*\['text'\]/);
  assert.match(realtime, /original audio/);
  assert.match(html, /本次最多 12 分钟/);
  assert.match(html, /听说读写能力地图/);
  assert.match(html, /开始 8–10 分钟听说分级/);
  assert.match(html, /互动模式 · 开发中/);
  assert.match(html, /没有测过的项目会明确标记/);
  assert.match(integration, /assessTutorPlacement/);
  assert.match(integration, /db\.saveAbilityProfile/);
  assert.match(integration, /mode === 'assessment'/);
  assert.match(services, /oralPlacementInstructions/);
  assert.match(services, /これは授業ではなく/);
  assert.match(storage, /abilityProfiles/);
  assert.doesNotMatch(realtime, /response:\s*\{\s*instructions:/);
  assert.match(realtimeRoute, /turn_detection:\s*null/);
  assert.match(services, /英語は絶対に使用しない/);
  assert.match(services, /守り続けるべき授業範囲ではない/);
  assert.match(services, /話題変更を拒否しない/);
  assert.match(services, /never as a required curriculum boundary/);
  assert.match(services, /今日はどんな一日でしたか/);
  assert.match(services, /最初からコンビニ、買い物、会計などのロールプレイを提案しない/);
  assert.match(html, /const topic=mode==='assessment'\?'自适应听说分级':'自由会話'/);
  assert.doesNotMatch(services, /各ターンは「短い日本語の反応/);
  assert.match(html, /逐语法点学习/);
  assert.match(html, /Hanabira/);
  assert.match(html, /正在生成课后复盘/);
  assert.match(integration, /reviewTutorSession/);
  assert.match(integration, /realtime-audio/);
  assert.match(integration, /transcript-fallback/);
  assert.match(integration, /addTutorReviewVocabulary/);
  assert.match(html, /课后生词与表达/);
  assert.match(html, /全部加入复习/);
  assert.match(html, /基于原始语音/);
  assert.match(integration, /loadGrammarCatalog/);
  assert.match(services, /reviewTutorConversation/);
  assert.match(services, /generateGrammarLesson/);
  assert.match(storage, /grammarProgress/);
});

test("supports Chinese and English learner onboarding with one frontend language selector", async () => {
  const [html, integration, storage] = await Promise.all([
    readFile(new URL("../public/AI_kotoba_newUI/AI-Kotoba.dc.html", import.meta.url), "utf8"),
    readFile(new URL("../public/AI_kotoba_newUI/integration.js", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-kotoba-web/js/storage.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /const UI_TEXT=\{/);
  assert.match(html, /'zh-CN':\{/);
  assert.match(html, /en:\{/);
  assert.match(html, /id="onboarding-language"/);
  assert.match(html, /id="settings-language"/);
  assert.match(html, /selfAssessedLevel/);
  assert.match(html, /learningGoal/);
  assert.match(html, /onSkipPlacement/);
  assert.doesNotMatch(html, /<label>母语<\/label>/);
  assert.doesNotMatch(html, /<label>解释语言<\/label>/);
  assert.match(integration, /const LEARNER_LANGUAGES = \[/);
  assert.match(integration, /code: 'zh-CN'/);
  assert.match(integration, /code: 'en'/);
  assert.match(integration, /nativeLanguage: selected\.nativeLanguage/);
  assert.match(integration, /explanationLanguage: selected\.explanationLanguage/);
  assert.match(storage, /onboardingCompleted: false/);
  assert.match(storage, /旧用户升级时不要强制重新走新手引导/);
});

test("folds pronunciation guidance into voice Tutor reviews instead of a standalone page", async () => {
  const [html, integration, realtime, layout, storage, server] = await Promise.all([
    readFile(new URL("../public/AI_kotoba_newUI/AI-Kotoba.dc.html", import.meta.url), "utf8"),
    readFile(new URL("../public/AI_kotoba_newUI/integration.js", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-kotoba-web/js/realtime.js", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-kotoba-web/js/storage.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/server.ts", import.meta.url), "utf8"),
  ]);
  await assert.rejects(
    readFile(new URL("../app/api/pronunciation/analyze/route.ts", import.meta.url), "utf8"),
    error => error?.code === "ENOENT",
  );
  await assert.rejects(
    readFile(new URL("../public/ai-kotoba-web/js/pronunciation.js", import.meta.url), "utf8"),
    error => error?.code === "ENOENT",
  );
  assert.doesNotMatch(html, /go\.pron/);
  assert.doesNotMatch(html, /nav\.pron/);
  assert.doesNotMatch(html, /pronunciationTitle/);
  assert.doesNotMatch(html, /发音诊断/);
  assert.doesNotMatch(html, /u\.pronunciation/);
  assert.doesNotMatch(html, /pronShort/);
  assert.doesNotMatch(integration, /前往发音诊断/);
  assert.doesNotMatch(layout, /发音诊断/);
  assert.doesNotMatch(storage, /pronunciationAttempts/);
  assert.doesNotMatch(server, /GLOBAL_DAILY_PRONUNCIATION_CHECKS/);
  assert.doesNotMatch(server, /"pronunciation"/);
  assert.match(html, /课后复盘只在原始语音证据清楚时提示发音或节奏问题/);
  assert.match(html, /Session reviews mention pronunciation or rhythm only when the original audio provides clear evidence/);
  assert.match(realtime, /include at most one cautious, practical note about intelligibility, rhythm, long vowels, or geminate consonants/);
  assert.match(realtime, /otherwise omit pronunciation feedback entirely/);
});

test("localizes every built-in dialogue, article, and seed flashcard in English", async () => {
  const [seedRaw, englishRaw, html, integration, storage] = await Promise.all([
    readFile(new URL("../public/ai-kotoba-web/seed.json", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-kotoba-web/seed-localizations.en.json", import.meta.url), "utf8"),
    readFile(new URL("../public/AI_kotoba_newUI/AI-Kotoba.dc.html", import.meta.url), "utf8"),
    readFile(new URL("../public/AI_kotoba_newUI/integration.js", import.meta.url), "utf8"),
    readFile(new URL("../public/ai-kotoba-web/js/storage.js", import.meta.url), "utf8"),
  ]);
  const seed = JSON.parse(seedRaw);
  const english = JSON.parse(englishRaw);
  const nonEnglish = /[\u3040-\u30ff\u3400-\u9fff]/;

  assert.equal(english.version, 2);
  const sentenceCount = (text, locale) =>
    Array.from(new Intl.Segmenter(locale, { granularity: "sentence" }).segment(text))
      .map(item => item.segment.trim())
      .filter(Boolean)
      .length;
  for (const scenario of seed.scenarios) {
    const localized = english.scenarios[scenario.id];
    assert.ok(localized, `missing English scenario ${scenario.id}`);
    assert.equal(localized.lines.length, scenario.lines.length);
    assert.equal(localized.vocabulary.length, scenario.vocabulary.length);
    assert.ok(localized.lines.every(line => line && !nonEnglish.test(line)));
    assert.ok(localized.vocabulary.every((item, index) =>
      item.word === scenario.vocabulary[index].word
      && item.meaning && item.example
      && !nonEnglish.test(item.meaning) && !nonEnglish.test(item.example)
    ));
  }
  for (const article of seed.articles) {
    const localized = english.articles[article.id];
    assert.ok(localized, `missing English article ${article.id}`);
    assert.equal(localized.paragraphs.length, article.paragraphs.length);
    assert.equal(localized.vocabulary.length, article.vocabulary.length);
    assert.ok(localized.paragraphs.every(paragraph => paragraph && !nonEnglish.test(paragraph)));
    localized.paragraphs.forEach((paragraph, index) => {
      assert.equal(
        sentenceCount(paragraph, "en"),
        sentenceCount(article.paragraphs[index].japanese, "ja"),
        `${article.id} paragraph ${index} must keep one English translation per Japanese sentence`,
      );
    });
    assert.ok(localized.vocabulary.every((item, index) =>
      item.word === article.vocabulary[index].word
      && item.meaning && item.example
      && !nonEnglish.test(item.meaning) && !nonEnglish.test(item.example)
    ));
  }
  assert.match(storage, /seed-localizations\.en\.json/);
  assert.match(storage, /seedLocalizationVersion/);
  assert.match(storage, /SEED_LOCALIZATION_VERSION = 2/);
  assert.match(storage, /hasCompleteSeedEnglish/);
  assert.match(storage, /addSeedEnglishToSavedVocabulary/);
  assert.match(integration, /item\?\.meaningEnglish/);
  assert.match(integration, /item\?\.exampleEnglish/);
  assert.match(html, /localizedVocabulary\(item,language\)/);
  assert.match(html, /l\.english\|\|l\.translationEnglish/);
  assert.match(html, /\{\{ flash\.exampleTranslation \}\}/);
  assert.match(html, /\.three-line-head\{grid-column:1\/-1/);
  assert.match(html, /\.three-line-original\{grid-column:2/);
  assert.match(integration, /translationParts\.length === parts\.length/);
});

test("embeds article generation controls in the Reading page", async () => {
  const html = await readFile(new URL("../public/AI_kotoba_newUI/AI-Kotoba.dc.html", import.meta.url), "utf8");
  assert.match(html, /class="article-generator-controls"/);
  assert.match(html, /value="\{\{ article\.topic \}\}"/);
  assert.match(html, /value="\{\{ article\.level \}\}"/);
  assert.match(html, /articleInput:'介绍日本夏日祭典'/);
  assert.match(html, /articleLevel:'N4'/);
  assert.match(html, /const request=String\(this\.state\.articleInput\|\|''\)\.trim\(\)/);
  assert.doesNotMatch(html, /window\.prompt\('想读什么主题？'/);
  assert.doesNotMatch(html, /window\.prompt\('JLPT 等级（N5–N1）'/);
});

test("adapts the full learning UI for mobile browsers", async () => {
  const html = await readFile(new URL("../public/AI_kotoba_newUI/AI-Kotoba.dc.html", import.meta.url), "utf8");
  assert.match(html, /@media \(max-width:760px\)/);
  assert.match(html, /class="app-shell"/);
  assert.match(html, /class="app-sidebar"/);
  assert.match(html, /position:fixed!important/);
  assert.match(html, /env\(safe-area-inset-bottom\)/);
  assert.match(html, /class="app-topbar"/);
  assert.match(html, /class="app-content"/);
  assert.match(html, /class="detail-header"/);
  assert.match(html, /class="detail-actions"/);
  assert.match(html, /\.article-generator-controls\{flex-direction:column\}/);
  assert.doesNotMatch(html, /class="tag tag-neutral">\{\{ sc\.topic \}\}<\/span>/);
  assert.match(html, /scrollMainTop\(\)/);
  assert.match(html, /scroll-padding-bottom:100px/);
});

test("adds an adaptive reading placement without changing oral ability", async () => {
  const [html, integration] = await Promise.all([
    readFile(new URL("../public/AI_kotoba_newUI/AI-Kotoba.dc.html", import.meta.url), "utf8"),
    readFile(new URL("../public/AI_kotoba_newUI/integration.js", import.meta.url), "utf8"),
  ]);
  assert.equal([...html.matchAll(/id:'n[1-5]-[12]'/g)].length, 10);
  assert.match(html, /const READING_LEVELS=\['N5','N4','N3','N2','N1'\]/);
  assert.match(html, /startReadingAssessment\(\)/);
  assert.match(html, /answerReadingQuestion\(choice\)/);
  assert.match(html, /this\._readingAnswers\.length>=5/);
  assert.match(html, /This result updates reading only|本结果只更新阅读能力/);
  assert.match(integration, /function saveReadingAssessment\(input = \{\}\)/);
  assert.match(integration, /\.\.\.\(previous\.dimensions \|\| \{\}\),\s*reading,/);
  assert.match(integration, /readingAssessmentHistory/);
  assert.match(integration, /saveReadingAssessment,/);
});

test("enforces global paid API caps and protects the admin usage dashboard", async () => {
  const [server, adminRoute, html, integration] = await Promise.all([
    readFile(new URL("../lib/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/usage/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/AI_kotoba_newUI/AI-Kotoba.dc.html", import.meta.url), "utf8"),
    readFile(new URL("../public/AI_kotoba_newUI/integration.js", import.meta.url), "utf8"),
  ]);
  assert.match(server, /GLOBAL_USAGE_EMAIL = "__global__"/);
  assert.match(server, /ai_text: \{ label: "文本 AI"[^\n]+global: 300/);
  assert.match(server, /realtime: \{ label: "Realtime Tutor"[^\n]+global: 30/);
  assert.match(server, /WHERE daily_usage\.count < \?/);
  assert.match(server, /scope: "global"/);
  assert.match(adminRoute, /if \(!isAdminUser\(user\)\)/);
  assert.match(adminRoute, /user_email = '__global__'/);
  assert.match(html, /管理员用量/);
  assert.match(html, /今天还没有付费 API 用量/);
  assert.match(integration, /\/api\/admin\/usage/);
});

test("shares conversations and articles through unlisted D1-backed links", async () => {
  const [shareRoute, schema, migration, html, integration] = await Promise.all([
    readFile(new URL("../app/api/share/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_unique_caretaker.sql", import.meta.url), "utf8"),
    readFile(new URL("../public/AI_kotoba_newUI/AI-Kotoba.dc.html", import.meta.url), "utf8"),
    readFile(new URL("../public/AI_kotoba_newUI/integration.js", import.meta.url), "utf8"),
  ]);
  assert.match(shareRoute, /export async function GET/);
  assert.match(shareRoute, /export async function POST/);
  assert.match(shareRoute, /export async function DELETE/);
  assert.match(shareRoute, /if \(!user\) return signInRequired\(\)/);
  assert.match(shareRoute, /SHARE_ID_PATTERN = \/\^\[a-f0-9\]\{32\}\$\//);
  assert.match(shareRoute, /created_by = \? AND content_hash = \?/);
  assert.match(schema, /sharedContent = sqliteTable/);
  assert.match(migration, /CREATE TABLE `shared_content`/);
  assert.match(html, /保存到我的学习库/);
  assert.match(html, /分析完成后可分享/);
  assert.match(html, /async copyShareLink\(url\)/);
  assert.match(html, /navigator\.clipboard\?\.writeText/);
  assert.match(html, /document\.execCommand\('copy'\)/);
  assert.match(html, /shareNotice:copied\?ui\.linkCopied:ui\.copyManually/);
  assert.doesNotMatch(html, /if\(navigator\.share\)/);
  assert.match(integration, /createShareLink/);
  assert.match(integration, /loadSharedContentFromLocation/);
  assert.match(integration, /saveSharedContent/);
});

test("includes licensed N5-N3 grammar catalogs", async () => {
  const levels = [["N5", 136], ["N4", 124], ["N3", 132]];
  for (const [level, expected] of levels) {
    const raw = await readFile(new URL(`../public/grammar/grammar_ja_${level}_full_alphabetical_0001.json`, import.meta.url), "utf8");
    const rows = JSON.parse(raw);
    assert.equal(rows.length, expected);
    assert.equal(typeof rows[0].title, "string");
    assert.ok(Array.isArray(rows[0].examples));
  }
});

test("rejects empty grammar lessons and unwraps valid structured output", () => {
  assert.equal(isCompleteGrammarLesson({ title: "〜たい" }), false);
  const lesson = normalizeGrammarLesson({ lesson: {
    title: "〜たい",
    meaning: "想做某事",
    explanation: "接在动词ます形去掉ます之后。用于表达说话人自己的愿望。",
    formation: "动词ます形（去掉ます）＋たい",
    pitfall: "描述第三人称愿望时通常不能直接使用〜たい。",
    examples: [
      { japanese: "日本へ行きたいです。", translation: "我想去日本。", note: "表达自己的愿望。" },
      { japanese: "寿司を食べたいです。", translation: "我想吃寿司。", note: "宾语常用を。" },
      { japanese: "今日は早く寝たいです。", translation: "今天想早点睡。", note: "日常表达。" },
    ],
    quiz: { prompt: "日本語を（　）たいです。", answer: "勉強し", explanation: "勉強します去掉ます。" },
  }});
  assert.equal(lesson.title, "〜たい");
  assert.equal(lesson.examples.length, 3);
  assert.equal(isCompleteGrammarLesson(lesson), true);
});

test("requests strict structured output for grammar lessons", async () => {
  const route = await readFile(new URL("../app/api/ai/route.ts", import.meta.url), "utf8");
  const integration = await readFile(new URL("../public/AI_kotoba_newUI/integration.js", import.meta.url), "utf8");
  assert.match(route, /type: "json_schema"/);
  assert.match(route, /strict: true/);
  assert.match(route, /grammar_lesson/);
  assert.match(route, /oral_placement/);
  assert.match(route, /oralPlacementSchema/);
  assert.match(integration, /isCompleteGrammarLesson\(existing\.lesson\)/);
  assert.match(integration, /lesson: null/);
});
