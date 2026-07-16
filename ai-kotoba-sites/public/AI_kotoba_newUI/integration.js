import * as db from '../ai-kotoba-web/js/storage.js';
import {
  generateArticle,
  generateGrammarLesson,
  generateScenario,
  freeTalkInstructions,
  oralPlacementInstructions,
  glossJapaneseTokens,
  isCompleteGrammarLesson,
  assessOralPlacement,
  reviewTutorConversation,
} from '../ai-kotoba-web/js/services.js';
import { startRealtimeSession } from '../ai-kotoba-web/js/realtime.js';

let initialized = false;
let activeSpeech = null;
let speechRequestId = 0;
let elevenLabsUnavailable = false;
const speechAudioCache = new Map();
let grammarCatalogPromise = null;
let accountState = { authenticated: false, isAdmin: false };
const LEARNER_LANGUAGES = [
  { code: 'zh-CN', label: '简体中文', nativeLanguage: 'Chinese', explanationLanguage: 'Simplified Chinese' },
  { code: 'en', label: 'English', nativeLanguage: 'English', explanationLanguage: 'English' },
];

async function updateAccountPill() {
  const pill = document.getElementById('account-pill');
  if (!pill) return;
  const english = db.getSettings().uiLanguage === 'en';
  try {
    const response = await fetch('/api/account', { cache: 'no-store' });
    const account = await response.json();
    accountState = account;
    pill.replaceChildren();
    const dot = document.createElement('span');
    dot.className = 'account-dot';
    pill.append(dot);
    pill.dataset.auth = account.authenticated ? 'true' : 'false';
    if (account.authenticated) {
      const name = document.createElement('span');
      name.textContent = `${account.displayName || (english ? 'Signed in' : '已登录')} · ${english ? 'Cloud sync' : '云同步'}`;
      const link = document.createElement('a');
      link.href = account.signoutUrl || '/signout-with-chatgpt';
      link.textContent = english ? 'Sign out' : '退出';
      link.style.opacity = '.58';
      pill.append(name, link);
    } else {
      const link = document.createElement('a');
      link.href = account.signinUrl || '/signin-with-chatgpt';
      link.textContent = english ? 'Sign in with ChatGPT · Enable AI and sync' : '用 ChatGPT 登录 · 开启 AI 与云同步';
      pill.append(link);
    }
  } catch {
    accountState = { authenticated: false, isAdmin: false };
    pill.innerHTML = `<span class="account-dot"></span><span>${english ? 'Guest demo' : '游客演示模式'}</span>`;
  }
  return accountState;
}

function cleanSpeechText(text) {
  return String(text || '').replace(/\[[^\]\n]+\]/g, '').trim();
}

function stopJapaneseSpeech() {
  speechRequestId += 1;
  if (activeSpeech) {
    activeSpeech.onended = null;
    activeSpeech.onerror = null;
    activeSpeech.pause();
    activeSpeech.currentTime = 0;
    activeSpeech = null;
  }
  try { window.speechSynthesis?.cancel(); } catch {}
}

function normalizeSpeechRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) ? Math.min(1.25, Math.max(0.5, rate)) : 0.75;
}

function getSpeechRate() {
  return normalizeSpeechRate(db.getSettings().ttsRate);
}

function setSpeechRate(value) {
  const rate = normalizeSpeechRate(value);
  db.saveSettings({ ...db.getSettings(), ttsRate: rate });
  return rate;
}

function normalizeTutorStyle(value) {
  return ['bilingual', 'conversation', 'correction', 'interview'].includes(String(value))
    ? String(value)
    : 'bilingual';
}

function getTutorStyle() {
  return normalizeTutorStyle(db.getSettings().tutorStyle);
}

function setTutorStyle(value) {
  const style = normalizeTutorStyle(value);
  db.saveSettings({ ...db.getSettings(), tutorStyle: style });
  return style;
}

function systemJapaneseSpeech(text, onEnd, rate = getSpeechRate()) {
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance !== 'function') {
    onEnd?.();
    throw new Error('浏览器不支持语音朗读');
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ja-JP';
  utterance.rate = normalizeSpeechRate(rate);
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
  return { engine: 'system' };
}

async function speakJapanese(source, { role = 'a', rate = getSpeechRate(), onEnd } = {}) {
  const text = cleanSpeechText(source);
  const playbackRate = normalizeSpeechRate(rate);
  stopJapaneseSpeech();
  if (!text) {
    onEnd?.();
    return { engine: 'none' };
  }
  const requestId = speechRequestId;
  if (!elevenLabsUnavailable) {
    try {
      const cacheKey = `${role === 'b' ? 'b' : 'a'}|${text}`;
      let audioUrl = speechAudioCache.get(cacheKey);
      if (!audioUrl) {
        const response = await fetch('/api/tts/elevenlabs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, role: role === 'b' ? 'b' : 'a' }),
        });
        if (!response.ok) {
          if ([401, 404].includes(response.status)) elevenLabsUnavailable = true;
          throw new Error((await response.json().catch(() => ({}))).error || 'ElevenLabs TTS unavailable');
        }
        audioUrl = URL.createObjectURL(await response.blob());
        speechAudioCache.set(cacheKey, audioUrl);
      }
      if (requestId !== speechRequestId) return { engine: 'cancelled' };
      const audio = new Audio(audioUrl);
      audio.playbackRate = playbackRate;
      audio.defaultPlaybackRate = playbackRate;
      audio.preservesPitch = true;
      activeSpeech = audio;
      audio.onended = () => {
        if (activeSpeech === audio) activeSpeech = null;
        onEnd?.();
      };
      audio.onerror = () => {
        if (activeSpeech === audio) activeSpeech = null;
        onEnd?.();
      };
      await audio.play();
      return { engine: 'elevenlabs' };
    } catch (error) {
      if (requestId !== speechRequestId) return { engine: 'cancelled' };
      console.info('ElevenLabs unavailable; using system Japanese voice.', error.message);
    }
  }
  return systemJapaneseSpeech(text, onEnd, playbackRate);
}

function normalizeTranslation(value) {
  const english = db.getSettings().uiLanguage === 'en';
  return String(english
    ? (value?.english || value?.translationEnglish || value?.translation || value?.localizedText || value?.chinese || '')
    : (value?.chinese || value?.translationChinese || value?.translation || value?.localizedText || value?.english || ''));
}

function preferredExplanationLanguage() {
  const settings = db.getSettings();
  return String(settings.explanationLanguage || settings.nativeLanguage || 'Simplified Chinese');
}

function learnerLanguageOptions() {
  return LEARNER_LANGUAGES.map(item => ({ ...item }));
}

function saveLearnerProfile(input = {}) {
  const current = db.getSettings();
  const selected = LEARNER_LANGUAGES.find(item => item.code === String(input.language || current.uiLanguage))
    || LEARNER_LANGUAGES[0];
  const next = {
    ...current,
    uiLanguage: selected.code,
    nativeLanguage: selected.nativeLanguage,
    explanationLanguage: selected.explanationLanguage,
  };
  if (input.selfAssessedLevel !== undefined) next.selfAssessedLevel = String(input.selfAssessedLevel);
  if (input.learningGoal !== undefined) next.learningGoal = String(input.learningGoal);
  if (input.onboardingCompleted !== undefined) next.onboardingCompleted = !!input.onboardingCompleted;
  db.saveSettings(next);
  document.documentElement.lang = selected.code;
  void updateAccountPill();
  return snapshot();
}

function usableMeaning(value, language) {
  const text = String(value || '').trim();
  if (!text || text === '—') return '';
  if (/chinese|中文|简体/i.test(language) && !/[\u3400-\u9fff]/.test(text)) return '';
  if (/english|英语|英文/i.test(language) && /[\u3400-\u9fff]/.test(text)) return '';
  return text;
}

function localizedVocabulary(item) {
  const english = db.getSettings().uiLanguage === 'en';
  return {
    ...item,
    meaning: String(english
      ? (item?.meaningEnglish || item?.meaning || item?.meaningChinese || '')
      : (item?.meaningChinese || item?.meaning || item?.meaningEnglish || '')),
    exampleTranslation: String(english
      ? (item?.exampleEnglish || item?.exampleTranslation || item?.exampleChinese || '')
      : (item?.exampleChinese || item?.exampleTranslation || item?.exampleEnglish || '')),
  };
}

function snapshot() {
  return {
    account: accountState,
    settings: db.getSettings(),
    scenarios: db.getScenarios(),
    articles: db.getArticles(),
    vocab: db.getVocab(),
    tutorSessions: db.getTutorSessions(),
    learningNotes: db.getLearningNotes(),
    grammarProgress: db.getGrammarProgress(),
    abilityProfile: db.getAbilityProfile(),
    streak: db.streakInfo(),
  };
}

async function loadAdminUsage() {
  const response = await fetch('/api/admin/usage', { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '读取管理员用量失败');
  return data;
}

async function createShareLink(type, content) {
  const response = await fetch('/api/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, content }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '创建分享链接失败');
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set('share', data.id);
  return { ...data, url: url.toString() };
}

async function loadSharedContentFromLocation() {
  const id = new URLSearchParams(window.location.search).get('share')?.trim();
  if (!id) return null;
  const response = await fetch(`/api/share?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '读取分享内容失败');
  return data;
}

function saveSharedContent(shared) {
  if (!shared?.id || !shared?.content || !['scenario', 'article'].includes(shared.type)) {
    throw new Error('分享内容格式无效');
  }
  const existing = shared.type === 'scenario'
    ? db.getScenarios().find(item => item.sharedFrom === shared.id)
    : db.getArticles().find(item => item.sharedFrom === shared.id);
  if (existing) return { data: snapshot(), content: existing, alreadySaved: true };
  const content = JSON.parse(JSON.stringify(shared.content));
  content.id = crypto.randomUUID();
  content.createdAt = Date.now();
  content.sharedFrom = shared.id;
  content.sharedBy = String(shared.sharedBy || 'AI-Kotoba 学习者');
  content.favorite = false;
  if (shared.type === 'scenario') db.saveScenario(content);
  else db.saveArticle(content);
  db.recordActivity();
  return { data: snapshot(), content, alreadySaved: false };
}

async function init() {
  if (!initialized) {
    await db.initSync();
    document.documentElement.lang = db.getSettings().uiLanguage === 'en' ? 'en' : 'zh-CN';
    await updateAccountPill();
    await db.loadSeeds();
    initialized = true;
  }
  return snapshot();
}

function kanaFromFurigana(source) {
  const text = String(source || '');
  return text.replace(/([\u3400-\u9fff々〆ヶ]+)\[([^\]]+)\]/g, '$2');
}

function readingMap(japanese, furigana) {
  const source = String(japanese || '');
  const annotated = String(furigana || japanese || '');
  const readings = Array.from(source, char => char);
  const re = /([\u3400-\u9fff々〆ヶ]+)\[([^\]]+)\]/g;
  let plain = '';
  let cursor = 0;
  let match;
  while ((match = re.exec(annotated))) {
    plain += annotated.slice(cursor, match.index);
    const start = Array.from(plain).length;
    const baseChars = Array.from(match[1]);
    readings[start] = match[2];
    for (let i = 1; i < baseChars.length; i += 1) readings[start + i] = '';
    plain += match[1];
    cursor = match.index + match[0].length;
  }
  return readings;
}

function furiganaSpans(furigana) {
  const annotated = String(furigana || '');
  const spans = [];
  const re = /([\u3400-\u9fff々〆ヶ]+)\[([^\]]+)\]/g;
  let plain = '';
  let cursor = 0;
  let match;
  while ((match = re.exec(annotated))) {
    plain += annotated.slice(cursor, match.index);
    const start = Array.from(plain).length;
    plain += match[1];
    spans.push({ surface: match[1], reading: match[2], start, end: Array.from(plain).length });
    cursor = match.index + match[0].length;
  }
  return spans;
}

function furiganaUnits(furigana) {
  const annotated = String(furigana || '');
  const units = [];
  const re = /([\u3400-\u9fff々〆ヶ]+)\[([^\]]+)\]/g;
  let plainOffset = 0;
  let cursor = 0;
  let match;
  const addLiteral = (text) => {
    for (const char of Array.from(text)) {
      units.push({ start: plainOffset, end: plainOffset + 1, surface: char, markup: char });
      plainOffset += 1;
    }
  };
  while ((match = re.exec(annotated))) {
    addLiteral(annotated.slice(cursor, match.index));
    const length = Array.from(match[1]).length;
    units.push({ start: plainOffset, end: plainOffset + length, surface: match[1], markup: match[0] });
    plainOffset += length;
    cursor = match.index + match[0].length;
  }
  addLiteral(annotated.slice(cursor));
  return units;
}

function sliceFurigana(furigana, start, end, fallback) {
  const pieces = [];
  for (const unit of furiganaUnits(furigana)) {
    if (unit.end <= start || unit.start >= end) continue;
    if (unit.start >= start && unit.end <= end) pieces.push(unit.markup);
    else {
      const chars = Array.from(unit.surface);
      const from = Math.max(0, start - unit.start);
      const to = Math.min(chars.length, end - unit.start);
      pieces.push(chars.slice(from, to).join(''));
    }
  }
  return pieces.join('') || fallback;
}

function splitParagraphIntoSentences(paragraph, sourceParagraphIndex) {
  const japanese = String(paragraph?.japanese || '');
  const segmenter = typeof Intl?.Segmenter === 'function'
    ? new Intl.Segmenter('ja', { granularity: 'sentence' })
    : null;
  const raw = segmenter
    ? Array.from(segmenter.segment(japanese))
    : Array.from(japanese.matchAll(/[^。！？!?]+[。！？!?]?/g), match => ({ segment: match[0], index: match.index || 0 }));
  const parts = raw.filter(part => String(part.segment || '').trim());
  const paragraphTranslation = normalizeTranslation(paragraph);
  const translationLocale = db.getSettings().uiLanguage === 'en' ? 'en' : 'zh';
  const translationSegmenter = typeof Intl?.Segmenter === 'function' && paragraphTranslation
    ? new Intl.Segmenter(translationLocale, { granularity: 'sentence' })
    : null;
  const translationParts = translationSegmenter
    ? Array.from(translationSegmenter.segment(paragraphTranslation), part => String(part.segment || '').trim()).filter(Boolean)
    : Array.from(
        paragraphTranslation.matchAll(translationLocale === 'en' ? /[^.!?]+[.!?]?/g : /[^。！？!?]+[。！？!?]?/g),
        match => String(match[0] || '').trim()
      ).filter(Boolean);
  const alignedTranslations = translationParts.length === parts.length
    ? translationParts
    : parts.length === 1
      ? [paragraphTranslation]
      : [];
  return parts.map((part, sentenceIndex) => {
    const start = Array.from(japanese.slice(0, part.index)).length;
    const sentence = String(part.segment);
    const end = start + Array.from(sentence).length;
    return {
      japanese: sentence,
      furigana: sliceFurigana(paragraph.furigana || japanese, start, end, sentence),
      translation: alignedTranslations[sentenceIndex] || '',
      sourceParagraphIndex,
      sentenceIndex,
    };
  });
}

function isIgnorableGlossToken(token) {
  const oneKana = Array.from(String(token.surface || '')).length === 1 && /^[\u3040-\u30ff]$/.test(String(token.surface || ''));
  return oneKana && ['助詞', '助動詞'].includes(String(token.pos || ''));
}

function mergeTokensForFurigana(tokens, paragraph, vocabulary) {
  const replacements = new Map();
  const skipped = new Set();
  for (const span of furiganaSpans(paragraph.furigana)) {
    const indexes = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.start >= span.start && token.end <= span.end) indexes.push(index);
    }
    if (indexes.length < 2) continue;
    const firstIndex = indexes[0];
    const lastIndex = indexes[indexes.length - 1];
    if (tokens[firstIndex].start !== span.start || tokens[lastIndex].end !== span.end) continue;
    const known = vocabulary.find(item => item.word === span.surface);
    const first = tokens[firstIndex];
    replacements.set(firstIndex, {
      ...first,
      surface: span.surface,
      reading: span.reading,
      start: span.start,
      end: span.end,
      dictionaryForm: String(known?.word || span.surface),
      normalizedForm: String(known?.word || span.surface),
      pos: known ? first.pos : '复合表达',
      partOfSpeech: known ? first.partOfSpeech : ['复合表达'],
      wordLike: true,
      meaning: String(known?.meaning || ''),
      example: String(known?.example || paragraph.japanese),
      exampleTranslation: String(known?.exampleTranslation || known?.exampleChinese || ''),
    });
    for (const index of indexes.slice(1)) skipped.add(index);
  }
  return tokens.flatMap((token, index) => skipped.has(index) ? [] : [replacements.get(index) || token]);
}

function tokenizeParagraph(paragraph, vocabulary = []) {
  const japanese = String(paragraph?.japanese || '');
  const furigana = String(paragraph?.furigana || japanese);
  const readings = readingMap(japanese, furigana);
  const segmenter = typeof Intl?.Segmenter === 'function'
    ? new Intl.Segmenter('ja', { granularity: 'word' })
    : null;
  const rawSegments = segmenter
    ? Array.from(segmenter.segment(japanese))
    : Array.from(japanese).map((segment, index) => ({ segment, index, isWordLike: /[\p{L}\p{N}]/u.test(segment) }));
  const dictionary = vocabulary
    .filter(item => item?.word)
    .sort((a, b) => String(b.word).length - String(a.word).length);
  const segments = [];
  for (let i = 0; i < rawSegments.length;) {
    const part = rawSegments[i];
    const known = dictionary.find(item => japanese.startsWith(String(item.word), part.index));
    if (!known) {
      segments.push(part);
      i += 1;
      continue;
    }
    const end = part.index + String(known.word).length;
    let j = i + 1;
    while (j < rawSegments.length && rawSegments[j].index < end) j += 1;
    segments.push({ segment: japanese.slice(part.index, end), index: part.index, isWordLike: true, known });
    i = j;
  }

  return segments.map((part) => {
    const start = Array.from(japanese.slice(0, part.index)).length;
    const length = Array.from(part.segment).length;
    const reading = readings.slice(start, start + length).join('') || part.segment;
    const known = part.known || vocabulary.find(item =>
      item.word === part.segment ||
      (part.segment.length > 1 && (item.word?.includes(part.segment) || part.segment.includes(item.word)))
    );
    const wordLike = part.isWordLike !== false && /[\p{L}\p{N}]/u.test(part.segment);
    const oneKana = Array.from(part.segment).length === 1 && /^[\u3040-\u30ff]$/.test(part.segment);
    return {
      surface: part.segment,
      reading,
      start,
      end: start + length,
      dictionaryForm: part.segment,
      normalizedForm: part.segment,
      pos: '',
      wordLike,
      glossable: wordLike && !oneKana,
      meaning: String(known?.meaning || ''),
      example: String(known?.example || japanese),
      exampleTranslation: String(known?.exampleTranslation || known?.exampleChinese || ''),
    };
  });
}

function prepareArticle(article) {
  const english = db.getSettings().uiLanguage === 'en';
  const vocabulary = Array.isArray(article?.vocabulary) ? article.vocabulary.map(localizedVocabulary) : [];
  const sentences = (article?.paragraphs || []).flatMap((paragraph, paragraphIndex) =>
    splitParagraphIntoSentences(paragraph, paragraphIndex)
  );
  return {
    ...article,
    localizedTitle: String(english
      ? (article?.titleEnglish || article?.localizedTitle || article?.titleChinese || '')
      : (article?.titleChinese || article?.localizedTitle || article?.titleEnglish || '')),
    vocabulary,
    paragraphs: sentences.map(paragraph => ({
      japanese: String(paragraph.japanese || ''),
      furigana: String(paragraph.furigana || paragraph.japanese || ''),
      reading: kanaFromFurigana(paragraph.furigana || paragraph.japanese),
      translation: normalizeTranslation(paragraph),
      tokens: tokenizeParagraph(paragraph, vocabulary),
    })),
  };
}

async function prepareArticleForStudy(article) {
  const prepared = prepareArticle(article);
  const vocabulary = Array.isArray(prepared.vocabulary) ? prepared.vocabulary : [];
  const translationLanguage = preferredExplanationLanguage();
  try {
    let paragraphs = await Promise.all(prepared.paragraphs.map(async paragraph => {
      const response = await fetch('/api/tokenize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: paragraph.japanese, mode: 'B' }),
      });
      if (!response.ok) throw new Error('SudachiPy unavailable');
      const result = await response.json();
      const articleReadingMap = readingMap(paragraph.japanese, paragraph.furigana);
      const tokens = (result.tokens || []).map(token => {
        const known = vocabulary.find(item =>
          item.word === token.surface ||
          item.word === token.dictionaryForm ||
          item.word === token.normalizedForm
        );
        const start = Array.from(paragraph.japanese.slice(0, Number(token.start) || 0)).length;
        const length = Array.from(String(token.surface || '')).length;
        const annotatedReading = articleReadingMap.slice(start, start + length).join('');
        const hasKanji = /[\u3400-\u9fff々〆ヶ]/.test(String(token.surface || ''));
        const reading = hasKanji && (!annotatedReading || annotatedReading === token.surface)
          ? String(token.readingHiragana || token.reading || token.surface || '')
          : String(annotatedReading || token.readingHiragana || token.reading || token.surface || '');
        return {
          surface: String(token.surface || ''),
          reading,
          start: Number(token.start) || 0,
          end: Number(token.end) || 0,
          dictionaryForm: String(token.dictionaryForm || token.surface || ''),
          normalizedForm: String(token.normalizedForm || token.surface || ''),
          pos: String(token.pos || ''),
          partOfSpeech: Array.isArray(token.partOfSpeech) ? token.partOfSpeech : [],
          wordLike: Boolean(token.wordLike),
          glossable: Boolean(token.wordLike) && !isIgnorableGlossToken(token),
          isOov: Boolean(token.isOov),
          meaning: String(known?.meaning || ''),
          example: String(known?.example || paragraph.japanese),
          exampleTranslation: String(known?.exampleTranslation || known?.exampleChinese || ''),
        };
      });
      return { ...paragraph, tokens: mergeTokensForFurigana(tokens, paragraph, vocabulary) };
    }));
    const signature = `${translationLanguage}\n${paragraphs.map(paragraph => paragraph.japanese).join('\n\u241e\n')}`;
    const cached = article?.wordGlosses;
    let glossRows = cached?.version === 'sudachi-b-context-v4' && cached.signature === signature
      ? cached.paragraphs
      : null;
    let sentenceTranslations = cached?.version === 'sudachi-b-context-v4' && cached.signature === signature
      ? cached.translations
      : null;
    if (!Array.isArray(glossRows) || glossRows.length !== paragraphs.length || !Array.isArray(sentenceTranslations)) {
      const generated = await glossJapaneseTokens({
        title: prepared.title,
        level: prepared.level,
        paragraphs,
        outputLanguage: translationLanguage,
      });
      glossRows = generated.glosses;
      sentenceTranslations = generated.translations;
      const wordGlosses = {
        version: 'sudachi-b-context-v4',
        language: translationLanguage,
        signature,
        paragraphs: glossRows,
        translations: sentenceTranslations,
      };
      if (article?.id) {
        const stored = db.getArticles().find(item => item.id === article.id);
        if (stored) db.updateArticle({ ...stored, wordGlosses });
      }
    }
    paragraphs = paragraphs.map((paragraph, paragraphIndex) => {
      const tokens = paragraph.tokens.map((token, tokenIndex) => ({
        ...token,
        gloss: String(glossRows?.[paragraphIndex]?.[tokenIndex] || token.meaning || ''),
      }));
      return {
        ...paragraph,
        tokens,
        translation: String(sentenceTranslations?.[paragraphIndex] || paragraph.translation || ''),
        glosses: tokens.filter(token => token.glossable).map(token => ({ surface: token.surface, gloss: token.gloss || '—' })),
      };
    });
    return { ...prepared, paragraphs, tokenizer: 'SudachiPy · B + 语境释义' };
  } catch {
    const paragraphs = prepared.paragraphs.map(paragraph => ({
      ...paragraph,
      glosses: (paragraph.tokens || []).filter(token => token.glossable !== false && token.wordLike).map(token => ({ surface: token.surface, gloss: token.meaning || '—' })),
    }));
    return { ...prepared, paragraphs, tokenizer: '浏览器分词' };
  }
}

async function addVocabulary(item) {
  const word = String(item?.word || item?.surface || '').trim();
  const language = preferredExplanationLanguage();
  const english = /english|英语|英文/i.test(language);
  const suppliedMeaning = english
    ? (item?.meaningEnglish || item?.meaning || item?.meaningChinese)
    : (item?.meaningChinese || item?.meaning || item?.meaningEnglish);
  let meaning = usableMeaning(item?.gloss, language) || usableMeaning(suppliedMeaning, language);
  if (!meaning && word) {
    const generated = await glossJapaneseTokens({
      title: '生词释义',
      level: String(item?.level || 'N4'),
      outputLanguage: language,
      paragraphs: [{
        japanese: String(item?.example || item?.sourceSentence || word),
        tokens: [{
          surface: String(item?.sourceSurface || item?.surface || word),
          dictionaryForm: word,
          partOfSpeech: Array.isArray(item?.partOfSpeech) ? item.partOfSpeech : [],
          wordLike: true,
          glossable: true,
        }],
      }],
    });
    meaning = usableMeaning(generated.glosses?.[0]?.[0], language);
  }
  if (!meaning) throw new Error(`暂时无法生成${language === 'Simplified Chinese' ? '中文' : ''}释义，请稍后重试`);
  const vocabItem = {
    word,
    reading: String(item?.reading || '').trim(),
    meaning,
    meaningLanguage: language,
    meaningChinese: String(item?.meaningChinese || (!english ? meaning : '')).trim(),
    meaningEnglish: String(item?.meaningEnglish || (english ? meaning : '')).trim(),
    example: String(item?.example || '').trim(),
    exampleChinese: String(item?.exampleChinese || (!english ? item?.exampleTranslation : '') || '').trim(),
    exampleEnglish: String(item?.exampleEnglish || (english ? item?.exampleTranslation : '') || '').trim(),
    exampleTranslation: String(english
      ? (item?.exampleEnglish || item?.exampleTranslation || item?.exampleChinese || '')
      : (item?.exampleChinese || item?.exampleTranslation || item?.exampleEnglish || '')).trim(),
    source: String(item?.source || 'three-line-reading').trim().slice(0, 40),
  };
  const existing = db.getVocab().find(entry => entry.word === word);
  let added;
  if (existing && !usableMeaning(existing.meaning, language)) {
    db.updateVocab({
      ...existing,
      ...vocabItem,
      reading: vocabItem.reading || existing.reading || '',
      example: vocabItem.example || existing.example || '',
      exampleTranslation: vocabItem.exampleTranslation || existing.exampleTranslation || '',
    });
    added = true;
  } else {
    added = db.addVocab(vocabItem);
  }
  if (added) db.recordActivity();
  return { added, data: snapshot() };
}

async function createArticle(request, level, onStatus) {
  const article = await generateArticle(request, level, onStatus);
  db.saveArticle(article);
  db.recordActivity();
  return prepareArticleForStudy(article);
}

async function createScenario(topic, level, onStatus) {
  const scenario = await generateScenario(topic, level, onStatus);
  db.saveScenario(scenario);
  db.recordActivity();
  return scenario;
}

function saveTutorSession(input = {}) {
  const messages = (Array.isArray(input.messages) ? input.messages : [])
    .map(item => ({
      role: item.role === 'me' ? 'me' : 'tutor',
      text: String(item.text || '').trim().slice(0, 4000),
      at: Number(item.at) || Date.now(),
    }))
    .filter(item => item.text)
    .slice(-200);
  if (!messages.length) return snapshot();
  const createdAt = Number(input.createdAt) || messages[0].at || Date.now();
  const endedAt = Number(input.endedAt) || Date.now();
  const session = {
    id: String(input.id || crypto.randomUUID()),
    scene: String(input.scene || input.topic || '日常会話').trim().slice(0, 80),
    level: /^N[1-5]$/.test(String(input.level)) ? String(input.level) : 'N4',
    style: normalizeTutorStyle(input.style),
    mode: input.mode === 'assessment' ? 'assessment' : 'tutor',
    createdAt,
    endedAt,
    durationMs: Math.max(0, endedAt - createdAt),
    userTurns: messages.filter(item => item.role === 'me').length,
    messages,
    transcript: messages.map(item => `${item.role === 'me' ? 'Learner' : 'Tutor'}: ${item.text}`).join('\n'),
    reviewStatus: input.mode === 'assessment' ? 'not-applicable' : 'pending',
    assessmentStatus: input.mode === 'assessment' ? 'pending' : 'not-applicable',
  };
  db.saveTutorSession(session);
  db.recordActivity();
  return { ...snapshot(), savedTutorSessionId: session.id };
}

function normalizePlacementDimension(value = {}) {
  const level = /^N[1-5]$/.test(String(value.level)) ? String(value.level) : 'N5';
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(value.score) || 0))),
    level,
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
    status: 'assessed',
    evidence: (Array.isArray(value.evidence) ? value.evidence : []).slice(0, 3).map(item => String(item || '').trim()).filter(Boolean),
    nextStep: String(value.nextStep || '').trim(),
  };
}

async function assessTutorPlacement(sessionId) {
  const session = db.getTutorSessions().find(item => item.id === sessionId);
  if (!session) throw new Error('找不到这次测评');
  if (session.assessment) return snapshot();
  db.updateTutorSession(sessionId, { assessmentStatus: 'generating', assessmentError: '' });
  try {
    const raw = await assessOralPlacement(session);
    const overallLevel = /^N[1-5]$/.test(String(raw?.recommendedLevel)) ? String(raw.recommendedLevel) : 'N5';
    const confidence = Math.max(0, Math.min(1, Number(raw?.confidence) || 0));
    const dimensions = raw?.dimensions || {};
    const assessment = {
      recommendedLevel: overallLevel,
      confidence,
      summary: String(raw?.summary || '').trim(),
      dimensions: Object.fromEntries(['listening', 'speaking', 'fluency', 'vocabulary', 'grammar', 'interaction', 'organization'].map(key => [key, normalizePlacementDimension(dimensions[key])])),
      canDo: (Array.isArray(raw?.canDo) ? raw.canDo : []).slice(0, 3).map(item => String(item || '').trim()).filter(Boolean),
      priorities: (Array.isArray(raw?.priorities) ? raw.priorities : []).slice(0, 3).map(item => String(item || '').trim()).filter(Boolean),
      caveats: (Array.isArray(raw?.caveats) ? raw.caveats : []).slice(0, 3).map(item => String(item || '').trim()).filter(Boolean),
      tutorAdaptation: {
        speechPace: ['slow', 'natural-slow', 'natural'].includes(raw?.tutorAdaptation?.speechPace) ? raw.tutorAdaptation.speechPace : 'natural-slow',
        japaneseComplexity: /^N[1-5]$/.test(String(raw?.tutorAdaptation?.japaneseComplexity)) ? String(raw.tutorAdaptation.japaneseComplexity) : overallLevel,
        correctionFrequency: ['low', 'medium', 'high'].includes(raw?.tutorAdaptation?.correctionFrequency) ? raw.tutorAdaptation.correctionFrequency : 'medium',
        supportLanguage: ['minimal', 'when-blocked', 'frequent'].includes(raw?.tutorAdaptation?.supportLanguage) ? raw.tutorAdaptation.supportLanguage : 'when-blocked',
        instructions: String(raw?.tutorAdaptation?.instructions || '').trim(),
      },
      generatedAt: Date.now(),
    };
    const previous = db.getAbilityProfile() || {};
    const unmeasured = key => previous.dimensions?.[key] || { status: 'unmeasured', score: null, level: null, confidence: 0, evidence: [], nextStep: key === 'reading' ? '完成一次分级阅读任务后更新' : '完成一次短文写作任务后更新' };
    const history = [
      { id: crypto.randomUUID(), sessionId, level: overallLevel, confidence, summary: assessment.summary, createdAt: Date.now() },
      ...(Array.isArray(previous.assessmentHistory) ? previous.assessmentHistory : []),
    ].slice(0, 12);
    db.saveAbilityProfile({
      ...previous,
      overallLevel,
      confidence,
      summary: assessment.summary,
      dimensions: {
        listening: assessment.dimensions.listening,
        speaking: assessment.dimensions.speaking,
        reading: unmeasured('reading'),
        writing: unmeasured('writing'),
      },
      oralDimensions: {
        fluency: assessment.dimensions.fluency,
        vocabulary: assessment.dimensions.vocabulary,
        grammar: assessment.dimensions.grammar,
        interaction: assessment.dimensions.interaction,
        organization: assessment.dimensions.organization,
      },
      canDo: assessment.canDo,
      priorities: assessment.priorities,
      caveats: assessment.caveats,
      tutorAdaptation: assessment.tutorAdaptation,
      assessmentHistory: history,
      lastAssessmentAt: Date.now(),
    });
    db.updateTutorSession(sessionId, { assessment, assessmentStatus: 'ready', assessmentError: '' });
    db.recordActivity();
  } catch (error) {
    db.updateTutorSession(sessionId, {
      assessmentStatus: 'error',
      assessmentError: String(error?.message || '分级结果生成失败').slice(0, 240),
    });
    throw error;
  }
  return snapshot();
}

function normalizeTutorReview(raw, source) {
  const cleanList = (value, limit = 3) => (Array.isArray(value) ? value : []).slice(0, limit);
  return {
    source,
    summary: String(raw?.summary || '').trim(),
    strengths: cleanList(raw?.strengths).map(value => String(value || '').trim()).filter(Boolean),
    improvements: cleanList(raw?.improvements).map(item => ({
      original: String(item?.original || '').trim(),
      better: String(item?.better || '').trim(),
      explanation: String(item?.explanation || '').trim(),
    })).filter(item => item.original || item.better),
    usefulPhrases: cleanList(raw?.usefulPhrases, 6).map(item => ({
      japanese: String(item?.japanese || item?.word || '').trim(),
      reading: String(item?.reading || '').trim(),
      meaning: String(item?.meaning || '').trim(),
      example: String(item?.example || '').trim(),
      exampleTranslation: String(item?.exampleTranslation || '').trim(),
    })).filter(item => item.japanese && item.meaning),
    grammarEvidence: cleanList(raw?.grammarEvidence).map(item => ({
      pattern: String(item?.pattern || '').trim(),
      level: ['N5', 'N4', 'N3', 'unknown'].includes(String(item?.level)) ? String(item.level) : 'unknown',
      result: item?.result === 'used-well' ? 'used-well' : 'needs-work',
      note: String(item?.note || '').trim(),
    })).filter(item => item.pattern),
    nextStep: String(raw?.nextStep || '').trim(),
    generatedAt: Date.now(),
  };
}

function usableRealtimeReview(raw) {
  return !!String(raw?.summary || '').trim()
    && Array.isArray(raw?.strengths)
    && Array.isArray(raw?.improvements)
    && Array.isArray(raw?.usefulPhrases);
}

async function reviewTutorSession(sessionId, realtimeReview = null) {
  const session = db.getTutorSessions().find(item => item.id === sessionId);
  if (!session) throw new Error('找不到这次通话');
  if (session.review) return snapshot();
  db.updateTutorSession(sessionId, { reviewStatus: 'generating', reviewError: '' });
  try {
    const fromRealtime = usableRealtimeReview(realtimeReview);
    const raw = fromRealtime ? realtimeReview : await reviewTutorConversation(session);
    const review = normalizeTutorReview(raw, fromRealtime ? 'realtime-audio' : 'transcript-fallback');
    db.updateTutorSession(sessionId, { review, reviewStatus: 'ready', reviewError: '' });
    review.grammarEvidence.forEach(item => db.addLearningNote({
      category: `语法 · ${item.level}`,
      original: item.result === 'needs-work' ? item.pattern : '',
      better: item.result === 'used-well' ? item.pattern : '',
      note: item.note,
      source: 'tutor-review',
    }));
  } catch (error) {
    db.updateTutorSession(sessionId, {
      reviewStatus: 'error',
      reviewError: String(error?.message || '复盘生成失败').slice(0, 240),
    });
    throw error;
  }
  return snapshot();
}

async function addTutorReviewVocabulary(sessionId, index) {
  const session = db.getTutorSessions().find(item => item.id === sessionId);
  const item = session?.review?.usefulPhrases?.[Number(index)];
  if (!item) throw new Error('找不到这条课后生词');
  return addVocabulary({
    word: item.japanese,
    reading: item.reading,
    meaning: item.meaning,
    example: item.example,
    exampleTranslation: item.exampleTranslation,
    source: 'tutor-review',
  });
}

async function addAllTutorReviewVocabulary(sessionId) {
  const session = db.getTutorSessions().find(item => item.id === sessionId);
  const phrases = Array.isArray(session?.review?.usefulPhrases) ? session.review.usefulPhrases : [];
  for (let index = 0; index < phrases.length; index += 1) {
    await addTutorReviewVocabulary(sessionId, index);
  }
  return snapshot();
}

function grammarId(level, title) {
  let hash = 2166136261;
  for (const char of `${level}|${title}`) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${level.toLowerCase()}-${(hash >>> 0).toString(36)}`;
}

async function loadGrammarCatalog() {
  grammarCatalogPromise ??= Promise.all(['N5', 'N4', 'N3'].map(async level => {
    const response = await fetch(`/grammar/grammar_ja_${level}_full_alphabetical_0001.json`);
    if (!response.ok) throw new Error(`无法加载 ${level} 语法资料`);
    const rows = await response.json();
    return (Array.isArray(rows) ? rows : []).map((item, index) => ({
      ...item,
      id: grammarId(level, item.title || String(index + 1)),
      level,
      order: index + 1,
    }));
  })).then(groups => groups.flat());
  return grammarCatalogPromise;
}

async function openGrammarLesson(input) {
  const id = String(input?.id || input || '');
  const point = (await loadGrammarCatalog()).find(item => item.id === id);
  if (!point) throw new Error('找不到这个语法点');
  const language = preferredExplanationLanguage();
  const existing = db.getGrammarProgress().find(item => item.id === id);
  if (existing?.lesson && existing.lessonLanguage === language && isCompleteGrammarLesson(existing.lesson)) {
    if (existing.status === 'unstarted') db.upsertGrammarProgress({ ...existing, status: 'studying' });
    return { point, lesson: existing.lesson, data: snapshot(), cached: true };
  }
  db.upsertGrammarProgress({
    id,
    level: point.level,
    title: point.title,
    status: existing?.status === 'mastered' ? 'mastered' : 'studying',
    lessonStatus: 'generating',
  });
  try {
    const lesson = await generateGrammarLesson(point);
    db.upsertGrammarProgress({
      id,
      level: point.level,
      title: point.title,
      status: existing?.status === 'mastered' ? 'mastered' : 'studying',
      lesson,
      lessonLanguage: language,
      lessonStatus: 'ready',
      lessonError: '',
    });
    db.recordActivity();
    return { point, lesson, data: snapshot(), cached: false };
  } catch (error) {
    db.upsertGrammarProgress({
      id,
      level: point.level,
      title: point.title,
      status: existing?.status === 'mastered' ? 'mastered' : 'studying',
      lesson: null,
      lessonStatus: 'error',
      lessonError: String(error?.message || '语法课程生成失败').slice(0, 240),
    });
    throw error;
  }
}

function setGrammarStatus(id, status) {
  const allowed = ['unstarted', 'studying', 'mastered'];
  const cleanStatus = allowed.includes(status) ? status : 'studying';
  const existing = db.getGrammarProgress().find(item => item.id === id) || { id };
  db.upsertGrammarProgress({ ...existing, status: cleanStatus });
  if (cleanStatus !== 'unstarted') db.recordActivity();
  return snapshot();
}

async function startTutor({ topic = '自由会話', level = 'N4', style, mode = 'tutor', onUserText, onAIDelta, onAIDone, onStatus, onError, onTimeRemaining, onTimeLimit }) {
  const settings = db.getSettings();
  const teachingStyle = normalizeTutorStyle(style || settings.tutorStyle);
  return startRealtimeSession({
    apiKey: settings.openaiKey,
    voice: settings.realtimeVoice || 'marin',
    inputLanguage: mode === 'assessment' || teachingStyle === 'bilingual' ? 'auto' : 'ja',
    instructions: mode === 'assessment'
      ? oralPlacementInstructions()
      : freeTalkInstructions(topic, db.getAbilityProfile()?.overallLevel || level, teachingStyle, db.getLearningNotes(8), db.getAbilityProfile()),
    onUserText,
    onAIDelta,
    onAIDone,
    onStatus,
    onError,
    onTimeRemaining,
    onTimeLimit,
    reviewLanguage: preferredExplanationLanguage(),
    onToolCall: async ({ name, args }) => {
      if (name === 'save_vocabulary') return addVocabulary(args);
      if (name === 'remember_learning_point') return db.addLearningNote({ ...args, source: 'realtime-tutor' });
      throw new Error(`Unsupported Tutor tool: ${name}`);
    },
  });
}

window.AIKotoba = {
  init,
  snapshot,
  prepareArticle,
  prepareArticleForStudy,
  addVocabulary,
  createArticle,
  createScenario,
  saveTutorSession,
  reviewTutorSession,
  addTutorReviewVocabulary,
  addAllTutorReviewVocabulary,
  assessTutorPlacement,
  startTutor,
  loadGrammarCatalog,
  openGrammarLesson,
  setGrammarStatus,
  loadAdminUsage,
  createShareLink,
  loadSharedContentFromLocation,
  saveSharedContent,
  cleanSpeechText,
  speakJapanese,
  stopJapaneseSpeech,
  getSpeechRate,
  setSpeechRate,
  getTutorStyle,
  setTutorStyle,
  learnerLanguageOptions,
  saveLearnerProfile,
};
window.dispatchEvent(new Event('ai-kotoba-ready'));
