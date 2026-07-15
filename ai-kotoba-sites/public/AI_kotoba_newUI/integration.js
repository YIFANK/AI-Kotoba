import * as db from '../ai-kotoba-web/js/storage.js';
import {
  generateArticle,
  generateScenario,
  freeTalkInstructions,
  glossJapaneseTokens,
} from '../ai-kotoba-web/js/services.js';
import { startRealtimeSession } from '../ai-kotoba-web/js/realtime.js';

let initialized = false;
let activeSpeech = null;
let speechRequestId = 0;
let elevenLabsUnavailable = false;
const speechAudioCache = new Map();

async function updateAccountPill() {
  const pill = document.getElementById('account-pill');
  if (!pill) return;
  try {
    const response = await fetch('/api/account', { cache: 'no-store' });
    const account = await response.json();
    pill.replaceChildren();
    const dot = document.createElement('span');
    dot.className = 'account-dot';
    pill.append(dot);
    pill.dataset.auth = account.authenticated ? 'true' : 'false';
    if (account.authenticated) {
      const name = document.createElement('span');
      name.textContent = `${account.displayName || '已登录'} · 云同步`;
      const link = document.createElement('a');
      link.href = account.signoutUrl || '/signout-with-chatgpt';
      link.textContent = '退出';
      link.style.opacity = '.58';
      pill.append(name, link);
    } else {
      const link = document.createElement('a');
      link.href = account.signinUrl || '/signin-with-chatgpt';
      link.textContent = '用 ChatGPT 登录 · 开启 AI 与云同步';
      pill.append(link);
    }
  } catch {
    pill.innerHTML = '<span class="account-dot"></span><span>游客演示模式</span>';
  }
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
  return String(value?.translation || value?.chinese || value?.localizedText || '');
}

function preferredExplanationLanguage() {
  const settings = db.getSettings();
  return String(settings.uiLanguage || '').toLowerCase().startsWith('zh')
    ? 'Simplified Chinese'
    : String(settings.explanationLanguage || settings.nativeLanguage || 'Simplified Chinese');
}

function usableMeaning(value, language) {
  const text = String(value || '').trim();
  if (!text || text === '—') return '';
  if (/chinese|中文|简体/i.test(language) && !/[\u3400-\u9fff]/.test(text)) return '';
  return text;
}

function snapshot() {
  return {
    settings: db.getSettings(),
    scenarios: db.getScenarios(),
    articles: db.getArticles(),
    vocab: db.getVocab(),
    tutorSessions: db.getTutorSessions(),
    learningNotes: db.getLearningNotes(),
    streak: db.streakInfo(),
  };
}

async function init() {
  if (!initialized) {
    await updateAccountPill();
    await db.initSync();
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
  return parts.map((part, sentenceIndex) => {
    const start = Array.from(japanese.slice(0, part.index)).length;
    const sentence = String(part.segment);
    const end = start + Array.from(sentence).length;
    return {
      japanese: sentence,
      furigana: sliceFurigana(paragraph.furigana || japanese, start, end, sentence),
      translation: parts.length === 1 ? normalizeTranslation(paragraph) : '',
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
  const vocabulary = Array.isArray(article?.vocabulary) ? article.vocabulary : [];
  const sentences = (article?.paragraphs || []).flatMap((paragraph, paragraphIndex) =>
    splitParagraphIntoSentences(paragraph, paragraphIndex)
  );
  return {
    ...article,
    localizedTitle: String(article?.localizedTitle || article?.titleChinese || ''),
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
  const vocabulary = Array.isArray(article?.vocabulary) ? article.vocabulary : [];
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
  let meaning = usableMeaning(item?.gloss, language) || usableMeaning(item?.meaning, language);
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
    example: String(item?.example || '').trim(),
    exampleTranslation: String(item?.exampleTranslation || '').trim(),
    source: 'three-line-reading',
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
  db.saveTutorSession({
    id: String(input.id || crypto.randomUUID()),
    scene: String(input.scene || input.topic || '日常会話').trim().slice(0, 80),
    level: /^N[1-5]$/.test(String(input.level)) ? String(input.level) : 'N4',
    style: normalizeTutorStyle(input.style),
    createdAt,
    endedAt,
    durationMs: Math.max(0, endedAt - createdAt),
    userTurns: messages.filter(item => item.role === 'me').length,
    messages,
    transcript: messages.map(item => `${item.role === 'me' ? 'Learner' : 'Tutor'}: ${item.text}`).join('\n'),
  });
  db.recordActivity();
  return snapshot();
}

async function startTutor({ topic = '日常会話', level = 'N4', style, onUserText, onAIDelta, onAIDone, onStatus, onError }) {
  const settings = db.getSettings();
  const teachingStyle = normalizeTutorStyle(style || settings.tutorStyle);
  return startRealtimeSession({
    apiKey: settings.openaiKey,
    voice: settings.realtimeVoice || 'marin',
    inputLanguage: teachingStyle === 'bilingual' ? 'auto' : 'ja',
    instructions: freeTalkInstructions(topic, level, teachingStyle, db.getLearningNotes(8)),
    onUserText,
    onAIDelta,
    onAIDone,
    onStatus,
    onError,
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
  startTutor,
  cleanSpeechText,
  speakJapanese,
  stopJapaneseSpeech,
  getSpeechRate,
  setSpeechRate,
  getTutorStyle,
  setTutorStyle,
};
window.dispatchEvent(new Event('ai-kotoba-ready'));
