// AI 服务层：两轮生成策略（第一轮纯日语，第二轮按学习者档案翻译）
import { getSettings } from './storage.js';

function learnerProfile() {
  const settings = getSettings();
  return {
    nativeLanguage: settings.nativeLanguage || 'Chinese',
    explanationLanguage: settings.explanationLanguage || 'Simplified Chinese',
    targetLanguage: 'Japanese',
    levelFramework: 'JLPT',
  };
}

function uiText(zh, en) {
  return getSettings().uiLanguage === 'en' ? en : zh;
}

// ---------- JSON 提取（对应 JSONParsingUtility.extractJSON） ----------
export function extractJSON(text) {
  // 1. ```json 代码块
  let m = text.match(/```json\s*([\s\S]*?)```/i);
  if (m) { try { return JSON.parse(m[1].trim()); } catch { /* fall through */ } }
  // 2. 普通 ``` 代码块
  m = text.match(/```\s*([\s\S]*?)```/);
  if (m) { try { return JSON.parse(m[1].trim()); } catch { /* fall through */ } }
  // 3. 括号配对算法（正确计数 { 和 }，处理字符串内的括号）
  const start = text.indexOf('{');
  if (start === -1) throw new Error('AI 返回内容中未找到 JSON');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('AI 返回的 JSON 不完整');
}

// ---------- 底层 API 调用 ----------
async function callClaude(prompt, settings) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.claudeKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.claudeModel || 'claude-sonnet-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude API 错误 (${res.status})`);
  }
  const data = await res.json();
  return (data.content || []).map(b => b.text || '').join('');
}

async function callOpenAI(prompt, settings, opts = {}) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${settings.openaiKey}`,
    },
    body: JSON.stringify({
      model: opts.fast
        ? (settings.openaiFastModel || 'gpt-5.6-luna')
        : (settings.openaiModel || 'gpt-4o'),
      messages: [{ role: 'user', content: prompt }],
      ...(opts.schema ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI API 错误 (${res.status})`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// 本地 CLI 桥接（server.py 提供 /api/ai，调用本机已登录的 claude / codex，免 API Key）
async function callLocal(prompt, settings, opts = {}) {
  let res;
  const engine = opts.engine || settings.localEngine || 'claude';
  let model = opts.model || (engine === 'openai'
    ? (settings.openaiFastModel || 'gpt-5.6-luna')
    : engine === 'codex'
      ? (settings.openaiModel || '')
      : (settings.claudeModel || ''));
  // fast：轻量任务（如助教答疑）用小模型提速；仅 claude 引擎支持别名
  if (opts.fast && engine === 'claude') model = 'haiku';
  try {
    res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, engine, model, schema: opts.schema || '' }),
    });
  } catch {
    throw new Error('无法连接本地桥接服务，请用 python3 server.py 启动本站（而非普通静态服务器）');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `本地 CLI 调用失败 (${res.status})`);
  return data.text || '';
}

export async function localCLIStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // 桥接服务未运行（例如部署在纯静态托管上）
  }
}

async function callAI(prompt, opts = {}) {
  const settings = getSettings();
  if (settings.provider === 'local') return callLocal(prompt, settings, opts);
  return settings.provider === 'openai' ? callOpenAI(prompt, settings, opts) : callClaude(prompt, settings);
}

async function callFastAI(prompt, opts = {}) {
  const settings = getSettings();
  if (settings.provider === 'openai' && settings.openaiKey) {
    return callOpenAI(prompt, settings, { ...opts, fast: true });
  }
  try {
    // 优先由本地 server 使用 .env 中的 Key，避免标准 API Key 暴露给浏览器。
    return await callLocal(prompt, settings, { ...opts, engine: 'openai', fast: true });
  } catch (serverOpenAIError) {
    try {
      return await callAI(prompt, { ...opts, fast: true });
    } catch (configuredProviderError) {
      if (settings.provider !== 'local' || settings.localEngine === 'codex') throw configuredProviderError;
      return callLocal(prompt, { ...settings, localEngine: 'codex', openaiModel: '' }, opts);
    }
  }
}

// ---------- AI 助教（课文旁答疑） ----------
export async function askAssistant({ title, body, level, quote, question, history = [] }) {
  const { nativeLanguage, explanationLanguage } = learnerProfile();
  const hist = history.map(h => `Question: ${h.q}\nAnswer: ${h.a}`).join('\n\n');
  const prompt = `You are a patient Japanese-language teaching assistant. The learner's native language is ${nativeLanguage}, their explanation language is ${explanationLanguage}, and their current level is JLPT ${level}.

Article: ${title}
${body}
${quote ? `\nSelected text: 「${quote}」` : ''}${hist ? `\n\nPrevious Q&A:\n${hist}` : ''}

Learner question: ${question}

Answer in ${explanationLanguage}. Be concise (3-6 sentences) and answer directly in the first sentence. If grammar or word choice is involved, add one short Japanese example. Stay focused on the question. Output only the answer.`;
  return callAI(prompt, { fast: true });
}

// ---------- 语音 Tutor 课后复盘 ----------
export async function reviewTutorConversation(session) {
  const { nativeLanguage, explanationLanguage } = learnerProfile();
  const transcript = String(session?.transcript || '').trim().slice(0, 24_000);
  if (!transcript) throw new Error('没有可复盘的通话文本');
  const prompt = `You are reviewing a Japanese-learning voice tutoring session.
Learner native language: ${nativeLanguage}
Explanation language: ${explanationLanguage}
Approximate level: JLPT ${session?.level || 'N4'}
Conversation topic: ${session?.scene || 'free conversation'}

Analyze only evidence that actually appears in the transcript. Do not invent pronunciation scores because audio is not provided. Focus on the learner's Japanese; ignore small speech-to-text punctuation mistakes. Give encouraging but specific feedback.

Return JSON only in this exact shape:
{
  "summary": "2-3 sentence overall review in ${explanationLanguage}",
  "strengths": ["up to 3 concrete strengths in ${explanationLanguage}"],
  "improvements": [{"original":"learner wording", "better":"natural Japanese correction", "explanation":"short explanation in ${explanationLanguage}"}],
  "usefulPhrases": [{"japanese":"useful Japanese sentence", "meaning":"meaning in ${explanationLanguage}"}],
  "grammarEvidence": [{"pattern":"Japanese grammar pattern", "level":"N5|N4|N3|unknown", "result":"used-well|needs-work", "note":"short evidence in ${explanationLanguage}"}],
  "nextStep": "one specific next practice task in ${explanationLanguage}"
}

Keep each array to at most 3 items. If there is too little learner Japanese, say so honestly and return fewer items.

Transcript:
${transcript}`;
  return extractJSON(await callFastAI(prompt, { schema: 'tutor_review' }));
}

export async function assessOralPlacement(session) {
  const { nativeLanguage, explanationLanguage } = learnerProfile();
  const transcript = String(session?.transcript || '').trim().slice(0, 24_000);
  if (!transcript) throw new Error('没有可用于分级的通话文本');
  const prompt = `You are a conservative Japanese oral placement assessor.
Learner native language: ${nativeLanguage}
Report language: ${explanationLanguage}

The transcript comes from a voice conversation, but automatic input transcription can contain recognition and punctuation errors. Judge only observable evidence. Listening comprehension may be inferred from whether answers address the tutor's spoken questions, but state uncertainty when evidence is weak. Do not score pronunciation because audio is not included.

Use these practical JLPT-aligned oral bands:
- N5: familiar words, memorized phrases, very short supported answers
- N4: handles routine daily exchanges and simple connected sentences
- N3: follows ordinary speech on familiar topics and explains experiences/reasons with some detail
- N2: sustains nuanced discussion with flexible language and good organization
- N1: precise, flexible, sophisticated interaction across unfamiliar topics

Return JSON only. Scores are 0-100 and confidence is 0-1. Evidence and advice must be in ${explanationLanguage}; quoted Japanese stays Japanese.
{
  "recommendedLevel": "N5|N4|N3|N2|N1",
  "confidence": 0.0,
  "summary": "short evidence-based placement summary",
  "dimensions": {
    "listening": {"score": 0, "level": "N5|N4|N3|N2|N1", "confidence": 0.0, "evidence": ["up to 3 observations"], "nextStep": "one next task"},
    "speaking": {"score": 0, "level": "N5|N4|N3|N2|N1", "confidence": 0.0, "evidence": ["up to 3 observations"], "nextStep": "one next task"},
    "fluency": {"score": 0, "level": "N5|N4|N3|N2|N1", "confidence": 0.0, "evidence": ["up to 2 observations"], "nextStep": "one next task"},
    "vocabulary": {"score": 0, "level": "N5|N4|N3|N2|N1", "confidence": 0.0, "evidence": ["up to 2 observations"], "nextStep": "one next task"},
    "grammar": {"score": 0, "level": "N5|N4|N3|N2|N1", "confidence": 0.0, "evidence": ["up to 2 observations"], "nextStep": "one next task"},
    "interaction": {"score": 0, "level": "N5|N4|N3|N2|N1", "confidence": 0.0, "evidence": ["up to 2 observations"], "nextStep": "one next task"},
    "organization": {"score": 0, "level": "N5|N4|N3|N2|N1", "confidence": 0.0, "evidence": ["up to 2 observations"], "nextStep": "one next task"}
  },
  "canDo": ["up to 3 demonstrated can-do statements"],
  "priorities": ["up to 3 practice priorities"],
  "caveats": ["important limitations, including no direct pronunciation score"],
  "tutorAdaptation": {
    "speechPace": "slow|natural-slow|natural",
    "japaneseComplexity": "N5|N4|N3|N2|N1",
    "correctionFrequency": "low|medium|high",
    "supportLanguage": "minimal|when-blocked|frequent",
    "instructions": "one concise instruction for future tutors in ${explanationLanguage}"
  }
}

If there are fewer than 3 meaningful learner turns, keep confidence below 0.45 and avoid a high placement.

Transcript:
${transcript}`;
  return extractJSON(await callFastAI(prompt, { schema: 'oral_placement' }));
}

// ---------- 逐语法点课程（开放资料为骨架，按学习者语言生成原创讲解） ----------
function unwrapGrammarLesson(value) {
  if (!value || typeof value !== 'object') return {};
  return value.lesson || value.grammarLesson || value.grammar_lesson || value.data || value;
}

export function normalizeGrammarLesson(value) {
  const raw = unwrapGrammarLesson(value);
  const clean = input => String(input || '').trim();
  const examples = (Array.isArray(raw.examples) ? raw.examples : [])
    .map(item => ({
      japanese: clean(item?.japanese || item?.jp),
      translation: clean(item?.translation || item?.meaning || item?.chinese),
      note: clean(item?.note || item?.explanation),
    }))
    .filter(item => item.japanese && item.translation)
    .slice(0, 3);
  const quiz = raw.quiz && typeof raw.quiz === 'object' ? raw.quiz : {};
  return {
    title: clean(raw.title || raw.pattern),
    meaning: clean(raw.meaning || raw.shortExplanation || raw.short_explanation),
    explanation: clean(raw.explanation || raw.longExplanation || raw.long_explanation),
    formation: clean(raw.formation || raw.structure),
    pitfall: clean(raw.pitfall || raw.commonMistake || raw.common_mistake),
    examples,
    quiz: {
      prompt: clean(quiz.prompt || quiz.question),
      answer: clean(quiz.answer),
      explanation: clean(quiz.explanation || quiz.note),
    },
  };
}

export function isCompleteGrammarLesson(lesson) {
  const value = normalizeGrammarLesson(lesson);
  return Boolean(
    value.title && value.meaning && value.explanation && value.formation && value.pitfall &&
    value.examples.length >= 2 && value.quiz.prompt && value.quiz.answer && value.quiz.explanation
  );
}

export async function generateGrammarLesson(point) {
  const { nativeLanguage, explanationLanguage } = learnerProfile();
  const source = {
    level: point?.level,
    title: point?.title,
    shortExplanation: point?.short_explanation,
    longExplanation: point?.long_explanation,
    formation: point?.formation,
    examples: (Array.isArray(point?.examples) ? point.examples : []).slice(0, 4),
  };
  const prompt = `Create a concise, accurate Japanese grammar micro-lesson for a learner whose native language is ${nativeLanguage}. The explanation language must be ${explanationLanguage}. Use the licensed source data below only as reference, and write the explanation freshly rather than translating it word-for-word.

Return JSON only:
{
  "title":"clean Japanese grammar pattern without romaji in parentheses",
  "meaning":"one-line meaning in ${explanationLanguage}",
  "explanation":"2-4 concise sentences in ${explanationLanguage}, including nuance and register",
  "formation":"clear formation notation",
  "pitfall":"one common mistake in ${explanationLanguage}",
  "examples":[{"japanese":"natural Japanese sentence","translation":"${explanationLanguage}","note":"brief usage note in ${explanationLanguage}"}],
  "quiz":{"prompt":"one fill-in-the-blank Japanese question","answer":"answer","explanation":"why in ${explanationLanguage}"}
}

Provide 3 examples. Keep the level appropriate for ${point?.level || 'N4'}. Verify that Japanese examples are natural.

Reference data:
${JSON.stringify(source)}`;
  const lesson = normalizeGrammarLesson(extractJSON(await callFastAI(prompt, { schema: 'grammar_lesson' })));
  if (!isCompleteGrammarLesson(lesson)) throw new Error('AI 返回的语法课程字段不完整，请重试');
  return lesson;
}

// ---------- 提示词（对应 Constants.scenarioPromptJapanese / scenarioPromptTranslation） ----------
function promptJapanese(topic, level) {
  const { nativeLanguage } = learnerProfile();
  return `あなたは経験豊富な日本語教師です。母語が「${nativeLanguage}」の日本語学習者のために、「${topic}」という場面の自然な日本語会話を作成してください。

要件：
- JLPT ${level} レベルに合った語彙と文法を使うこと
- 2人の話者による8〜12行の自然でリアルな会話にすること
- 教科書的な不自然な表現を避け、実際に日本人が使う言い回しにすること
- speaker は speaker フィールドだけに書き、japanese と furigana の先頭に話者名や「話者名、」を絶対に含めないこと
- 会話から学習価値の高い単語・表現を6〜10個選ぶこと

以下のJSON形式のみで出力してください。説明文やその他のテキストは一切不要です：
{
  "title": "会話のタイトル（日本語）",
  "conversation": [
    {"speaker": "話者名", "japanese": "セリフ", "furigana": "同じセリフに、漢字を含む語の直後に読みがなを[ ]で付けた形式。例：私[わたし]は学生[がくせい]です。同形異音語（紅葉＝もみじ/こうよう、明日＝あした/あす、辛い＝からい/つらい など）は、必ず文の意味に合う読みを選ぶこと。"}
  ],
  "vocabulary": [
    {"word": "単語", "reading": "よみかた", "example": "例文"}
  ]
}`;
}

function promptTranslation(japaneseJSON) {
  const { explanationLanguage } = learnerProfile();
  return `Below is Japanese conversation JSON. Add natural translations in ${explanationLanguage}.

1. Add a "translation" field to every conversation item in natural ${explanationLanguage}.
2. Add "meaning" and "exampleTranslation" to every vocabulary item, both in ${explanationLanguage}.
3. Add top-level "localizedTitle" in ${explanationLanguage}; keep "title" in Japanese.
4. Do not modify any Japanese content.

Return only the complete JSON:

${JSON.stringify(japaneseJSON, null, 2)}`;
}

function stripFuriganaAnnotations(text) {
  return String(text || '').replace(/\[[^\]\n]+\]/g, '');
}

export function stripRepeatedSpeakerPrefix(text, speaker) {
  const source = String(text || '').trimStart();
  const speakerLabel = stripFuriganaAnnotations(speaker).replace(/[\s　]/g, '');
  if (!source || !speakerLabel) return source;
  const match = source.match(/^([\s\S]{1,64}?)[、，,:：][\s　]*/u);
  if (!match) return source;
  const leadingLabel = stripFuriganaAnnotations(match[1]).replace(/[\s　]/g, '');
  return leadingLabel === speakerLabel ? source.slice(match[0].length).trimStart() : source;
}

function mergeTranslatedRows(japaneseRows = [], translatedRows = []) {
  return japaneseRows.map((source, index) => {
    const translated = translatedRows[index] || {};
    return {
      ...translated,
      ...source,
      translation: String(translated.translation || translated.chinese || ''),
    };
  });
}

function mergeTranslatedVocabulary(japaneseRows = [], translatedRows = []) {
  return japaneseRows.map((source, index) => {
    const translated = translatedRows[index] || {};
    return {
      ...translated,
      ...source,
      meaning: String(translated.meaning || ''),
      exampleTranslation: String(translated.exampleTranslation || translated.exampleChinese || ''),
    };
  });
}

// ---------- 两轮场景生成 ----------
export async function generateScenario(topic, level, onStatus) {
  // 第一轮：纯日语生成（避免中日夹杂导致的不自然表达）
  onStatus?.(uiText('第一轮：正在生成地道的日语会话…', 'Step 1: Writing natural Japanese dialogue…'));
  const raw1 = await callAI(promptJapanese(topic, level));
  const japaneseOnly = extractJSON(raw1);
  if (!Array.isArray(japaneseOnly.conversation) || japaneseOnly.conversation.length === 0) {
    throw new Error('AI 返回的会话内容为空，请重试');
  }

  // 第二轮：翻译
  onStatus?.(uiText('第二轮：正在添加所选语言的翻译…', 'Step 2: Translating into your explanation language…'));
  const raw2 = await callAI(promptTranslation(japaneseOnly));
  const full = extractJSON(raw2);
  const merged = {
    ...full,
    title: japaneseOnly.title || full.title,
    conversation: mergeTranslatedRows(japaneseOnly.conversation, full.conversation),
    vocabulary: mergeTranslatedVocabulary(japaneseOnly.vocabulary, full.vocabulary),
  };

  return normalizeScenario(merged, topic, level);
}

function normalizeScenario(data, topic, level) {
  const lines = (data.conversation || []).map((l, i) => {
    const speaker = String(l.speaker || (i % 2 === 0 ? 'A' : 'B'));
    const rawJapanese = String(l.japanese || '');
    const rawAnnotated = String(l.furigana || '') || (/\[[^\]]+\]/.test(rawJapanese) ? rawJapanese : '');
    const japanese = stripRepeatedSpeakerPrefix(stripFuriganaAnnotations(rawJapanese), speaker);
    const annotated = stripRepeatedSpeakerPrefix(rawAnnotated, speaker);
    return {
      orderIndex: i,
      speaker,
      japanese,
      furigana: annotated || japanese,
      translation: String(l.translation || l.chinese || ''),
    };
  }).filter(l => l.japanese);
  const vocabulary = (data.vocabulary || []).map(v => ({
    word: String(v.word || ''),
    reading: String(v.reading || ''),
    meaning: String(v.meaning || ''),
    example: String(v.example || ''),
    exampleTranslation: String(v.exampleTranslation || v.exampleChinese || ''),
  })).filter(v => v.word);
  return {
    id: crypto.randomUUID(),
    title: String(data.title || topic),
    localizedTitle: String(data.localizedTitle || data.titleChinese || ''),
    translationLanguage: learnerProfile().explanationLanguage,
    topic, level,
    createdAt: Date.now(),
    favorite: false,
    lines, vocabulary,
  };
}

// ---------- 阅读文章生成（同样两轮：日语原文 → 中文翻译） ----------
function promptArticleJapanese(request, level) {
  const { nativeLanguage } = learnerProfile();
  return `あなたは経験豊富な日本語教師です。母語が「${nativeLanguage}」の日本語学習者のために、以下のリクエストに沿った読み物（短い文章）を書いてください。

リクエスト：「${request}」

要件：
- JLPT ${level} レベルに合った語彙と文法を使うこと
- 3〜6段落、全体で400〜700字程度
- 自然で読みやすく、内容が面白い文章にすること
- 文章から学習価値の高い単語・表現を6〜10個選ぶこと

以下のJSON形式のみで出力してください。説明文やその他のテキストは一切不要です：
{
  "title": "文章のタイトル（日本語）",
  "paragraphs": [
    {"japanese": "段落の本文", "furigana": "同じ本文に、漢字を含む語の直後に読みがなを[ ]で付けた形式。例：私[わたし]は漫画[まんが]が好[す]きです。同形異音語（紅葉＝もみじ/こうよう、明日＝あした/あす、辛い＝からい/つらい など）は、必ず文の意味に合う読みを選ぶこと。"}
  ],
  "vocabulary": [
    {"word": "単語", "reading": "よみかた", "example": "例文"}
  ]
}`;
}

function promptArticleTranslation(japaneseJSON) {
  const { explanationLanguage } = learnerProfile();
  return `Below is Japanese article JSON. Add natural translations in ${explanationLanguage}.

1. Add "translation" to every paragraph in natural ${explanationLanguage}.
2. Add "meaning" and "exampleTranslation" to every vocabulary item, both in ${explanationLanguage}.
3. Add top-level "localizedTitle" in ${explanationLanguage}; keep "title" in Japanese.
4. Do not modify any Japanese content.

Return only the complete JSON:

${JSON.stringify(japaneseJSON, null, 2)}`;
}

export async function generateArticle(request, level, onStatus) {
  onStatus?.(uiText('第一轮：正在撰写日语文章…', 'Step 1: Writing the Japanese article…'));
  const raw1 = await callAI(promptArticleJapanese(request, level));
  const japaneseOnly = extractJSON(raw1);
  if (!Array.isArray(japaneseOnly.paragraphs) || japaneseOnly.paragraphs.length === 0) {
    throw new Error('AI 返回的文章内容为空，请重试');
  }

  onStatus?.(uiText('第二轮：正在添加所选语言的翻译…', 'Step 2: Translating into your explanation language…'));
  const raw2 = await callAI(promptArticleTranslation(japaneseOnly));
  const full = extractJSON(raw2);
  const mergedParagraphs = mergeTranslatedRows(japaneseOnly.paragraphs, full.paragraphs);
  const mergedVocabulary = mergeTranslatedVocabulary(japaneseOnly.vocabulary, full.vocabulary);

  const paragraphs = mergedParagraphs.map(p => {
    const rawJapanese = String(p.japanese || '');
    const annotated = String(p.furigana || '') || (/\[[^\]]+\]/.test(rawJapanese) ? rawJapanese : '');
    const japanese = stripFuriganaAnnotations(rawJapanese);
    return {
      japanese,
      furigana: annotated || japanese,
      translation: String(p.translation || p.chinese || ''),
    };
  }).filter(p => p.japanese);
  const vocabulary = mergedVocabulary.map(v => ({
    word: String(v.word || ''),
    reading: String(v.reading || ''),
    meaning: String(v.meaning || ''),
    example: String(v.example || ''),
    exampleTranslation: String(v.exampleTranslation || v.exampleChinese || ''),
  })).filter(v => v.word);
  return {
    id: crypto.randomUUID(),
    title: String(japaneseOnly.title || full.title || request),
    localizedTitle: String(full.localizedTitle || full.titleChinese || ''),
    translationLanguage: learnerProfile().explanationLanguage,
    request, level,
    createdAt: Date.now(),
    paragraphs, vocabulary,
  };
}

// ---------- 文章逐词释义（Sudachi 负责边界，AI 只补当前语境下的短释义） ----------
export async function glossJapaneseTokens({ title, level, paragraphs, outputLanguage }) {
  const explanationLanguage = String(outputLanguage || learnerProfile().explanationLanguage || 'Simplified Chinese');
  const tokenRows = (paragraphs || []).map((paragraph, paragraphIndex) => ({
    paragraph: paragraphIndex,
    sentence: paragraph.japanese,
    tokens: (paragraph.tokens || []).map((token, tokenIndex) => ({
      token: tokenIndex,
      surface: token.surface,
      dictionaryForm: token.dictionaryForm,
      partOfSpeech: token.partOfSpeech,
      selectable: token.wordLike,
      glossable: token.glossable,
    })),
  }));
  const prompt = `You are preparing contextual interlinear glosses for a JLPT ${level} Japanese article titled "${title}".

For every token where glossable=true, provide one very short contextual gloss in ${explanationLanguage}. Also provide one natural sentence translation for every paragraph row. Each paragraph row contains exactly one Japanese sentence.

Rules:
- Preserve paragraph and token indexes exactly.
- Translate the meaning or grammatical function in this sentence, not every dictionary sense.
- Tokens where glossable=false must not receive a gloss.
- Keep each gloss compact, normally 1-6 words.
- Glosses must not contain kana, romaji, examples, or full-sentence translations; sentence translations belong only in the translations array.
- Every gloss and every sentence translation must be written in ${explanationLanguage}. Do not switch to English unless ${explanationLanguage} is English.
- Return JSON only in this shape: {"glosses":[{"paragraph":0,"token":0,"gloss":"..."}],"translations":[{"paragraph":0,"translation":"..."}]}.

Input:
${JSON.stringify(tokenRows)}`;
  const requestGlosses = requestPrompt => callFastAI(requestPrompt);
  let parsed = extractJSON(await requestGlosses(prompt));
  const requiresChinese = /chinese|中文|简体/i.test(explanationLanguage);
  const returnedValues = () => [
    ...(parsed.glosses || []).map(item => String(item.gloss || '')),
    ...(parsed.translations || []).map(item => String(item.translation || '')),
  ].filter(Boolean);
  const containsEnglishOnly = value => /[A-Za-z]/.test(value) && !/[\u3400-\u9fff]/.test(value);
  if (requiresChinese && returnedValues().some(containsEnglishOnly)) {
    const retryPrompt = `${prompt}\n\nYour previous response used the wrong language. Regenerate the complete JSON now. All glosses and translations must be in Simplified Chinese (简体中文), with no English explanations.`;
    parsed = extractJSON(await requestGlosses(retryPrompt));
  }
  const rows = Array.from({ length: tokenRows.length }, (_, paragraphIndex) =>
    Array.from({ length: tokenRows[paragraphIndex].tokens.length }, () => '')
  );
  for (const item of parsed.glosses || []) {
    const p = Number(item.paragraph);
    const t = Number(item.token);
    if (Number.isInteger(p) && Number.isInteger(t) && rows[p] && t >= 0 && t < rows[p].length) {
      rows[p][t] = String(item.gloss || '').trim().slice(0, 80);
    }
  }
  const translations = Array.from({ length: tokenRows.length }, () => '');
  for (const item of parsed.translations || []) {
    const p = Number(item.paragraph);
    if (Number.isInteger(p) && p >= 0 && p < translations.length) {
      translations[p] = String(item.translation || '').trim();
    }
  }
  return { glosses: rows, translations };
}

// ---------- AI Tutor（文字模式与 Realtime 共用教学策略） ----------
function learningMemoryBlock(learningNotes = []) {
  const notes = learningNotes.slice(0, 8).map(item => {
    const correction = [item.original, item.better].filter(Boolean).join(' → ');
    return `- [${item.category || '学习重点'}] ${correction}${item.note ? `（${item.note}）` : ''}`;
  });
  return notes.length ? `\n\nこの学習者の最近の重点項目：\n${notes.join('\n')}\n学習者が関連する質問をした時、または今の話題に自然に関係する時だけ参考にしてください。こちらから復習テストや反復を強制しないでください。` : '';
}

function abilityAdaptationBlock(abilityProfile) {
  const adaptation = abilityProfile?.tutorAdaptation;
  if (!adaptation || !abilityProfile?.overallLevel) return '';
  const pace = { slow: 'かなりゆっくり', 'natural-slow': '自然だが少しゆっくり', natural: '自然な速度' }[adaptation.speechPace] || '少しゆっくり';
  return `

能力マップによる調整：
- 現在の推定レベルは ${abilityProfile.overallLevel}（信頼度 ${Math.round((Number(abilityProfile.confidence) || 0) * 100)}%）
- 話す速度は「${pace}」、日本語の複雑さは ${adaptation.japaneseComplexity || abilityProfile.overallLevel} を目安にする
- 学習者が詰まる前から答えを与えず、必要な待ち時間を作る
- 個人化メモ：${adaptation.instructions || '学習者の反応に合わせて一段階ずつ難しくする'}
これは固定レベルではない。学習者が楽に答えられる時は少し難しくし、負荷が高すぎる時は一段階戻す。`;
}

export function freeTalkInstructions(scene, level, style = 'conversation', learningNotes = [], abilityProfile = null) {
  const { nativeLanguage, explanationLanguage } = learnerProfile();
  const bilingual = style === 'bilingual';
  const styleRule = {
    bilingual: `自然な日本語会話を基本にする。学習者が明確に助けを求めた時、理解できないと言った時、または ${explanationLanguage} だけで答えて橋渡しが必要な時に限り、${explanationLanguage} で短く補助する`,
    conversation: '会話の流れを最優先し、小さな間違いは止めすぎない。重要な間違いだけ自然な言い換えで示す',
    correction: '学習者の発話にまず内容で反応し、その後「より自然には〜」の形で重要な誤りを一つだけ短く直す',
    interview: '日本語の口頭試験官として、一問ずつ質問する。回答を短く評価してから次の質問へ進む',
  }[style] || '自然な会話を続ける';
  const languageRule = bilingual ? `
二言語モード：
- 既定は日本語。${explanationLanguage} は常時併記せず、必要な時だけ一文以内で使う
- 毎ターン同じ授業パターンにしない。質問、訂正、翻訳、復唱を毎回入れる必要はない
- 学習者が ${explanationLanguage} で答えた場合は内容に自然に反応し、役立つ時だけ短い日本語表現を一つ提案する。復唱は強制しない
- 求められていない文法解説、逐文翻訳、過度な励まし、理解確認をしない
- 二つの言語は文の途中で混ぜず、文の境界で切り替える
- 日本語は普段より少しゆっくり、語のまとまりごとに自然な間を置いて話す
` : '';
  return `最重要の言語規則：日本語と「${explanationLanguage}」だけを使用してください。「${explanationLanguage}」が英語でない限り、英語は絶対に使用しないでください。この規則は長い会話で古い発言が省略された後も変わりません。

あなたは、母語が「${nativeLanguage}」の学習者のための、自然に会話できる日本語音声チューターです。「${scene}」というテーマで、JLPT ${level} 相当の学習者と話してください。説明が本当に必要な場合だけ「${explanationLanguage}」を使ってください。

話題の扱い：
- 「${scene}」は会話を始めるための最初の場面であり、守り続けるべき授業範囲ではない
- 学習者が別の話題を出したり場面変更を求めたりしたら、許可を求めさせず、その話題へ自然に移る
- 「今のテーマを終えてから」「まず元の練習を続けましょう」などと言って話題変更を拒否しない
- 学習者が望まない限り、元の話題へ無理に戻さない

指導方針：${styleRule}。
${languageRule}

会話ルール：
- 基本は自然な日本語で話し、語彙・文法・速度を ${level} に合わせる
- 返答は通常1〜3文。一度に質問は一つまでだが、毎ターン質問で終える必要はない
- 意味が通じたらまず内容に反応し、細かすぎる訂正で会話を止めない
- 学習者が求めた時、意味が通じない時、または重要な誤りが繰り返された時だけ訂正する。訂正は一度に一つまで
- 発音について聞かれたら、かな表記と口の動かし方・アクセントの短いヒントを出す
- 学習者が助けを求めた場合は ${explanationLanguage} で短く助け、その後日本語へ戻る
- 教師として常に主導せず、会話相手として沈黙や話題転換も受け入れる。教科書的な進行、毎回の称賛、復唱の強制を避ける
- 長い会話で文脈が不足した場合は、日本語で短く確認する。英語や第三の言語へ切り替えない
- 学習者が表現の保存や弱点の記録を明確に頼んだ場合だけ、利用可能な保存ツールを使う
- セッション開始時は短く挨拶し、今日のテーマに合う最初の質問を一つだけする${abilityAdaptationBlock(abilityProfile)}${learningMemoryBlock(learningNotes)}`;
}

export function oralPlacementInstructions() {
  const { nativeLanguage, explanationLanguage } = learnerProfile();
  return `最重要の言語規則：日本語と「${explanationLanguage}」だけを使用してください。「${explanationLanguage}」が英語でない限り、英語は絶対に使用しないでください。

あなたは、母語が「${nativeLanguage}」の学習者に対する、日本語の適応型・音声プレースメント面接官です。これは授業ではなく、8〜10分程度の自然な会話による聞く力・話す力の測定です。

面接の進め方：
1. 短い自己紹介と身近な日常質問から始める
2. あなたが伝えた具体的な情報を、次の質問で理解できたか自然に確認する
3. 買い物・予定変更などの短いロールプレイを行う
4. 過去の経験、理由、比較を説明してもらう
5. 余裕があれば N3 以上の少し抽象的な質問へ進み、難しければ一段階戻す

厳守事項：
- 一度に一つの短い質問だけを出す。面接段階、JLPT レベル、採点意図は学習者に見せない
- 正誤を教えたり、文法を解説したり、模範解答を先に与えたりしない
- 小さな誤りは訂正せず、答えの内容にだけ自然に反応して次の課題へ進む
- 学習者が聞き返した時は一度だけ、同じ意味をより簡単な日本語で言い換える
- 完全に行き詰まった時だけ「${explanationLanguage}」で一文以内の補助を出す
- 発音を数値評価すると約束しない。この面接の後、会話証拠から聞く力と話す力を判定する
- 十分な証拠が集まったら「測定に必要な会話はできました。終了ボタンを押してください」と短く案内する
- 最初の発話は日本語で短く挨拶し、名前または今日したことを尋ねる`;
}

export async function freeTalkReply(scene, level, history, userMsg, style = 'conversation', learningNotes = []) {
  const { nativeLanguage, explanationLanguage } = learnerProfile();
  const bilingual = style === 'bilingual';
  const lines = history.map(h => `${h.role === 'me' ? 'Learner' : 'Tutor'}: ${h.text}`).join('\n');
  const styleRule = {
    bilingual: `自然な日本語会話を基本にし、学習者が助けを求めた時だけ ${explanationLanguage} を一文以内で使う`,
    conversation: '优先保持自然对话，只纠正影响理解或很不自然的错误',
    correction: '先回应内容，再用「より自然には〜」只纠正一个最重要的问题',
    interview: '像日语口试考官一样，简短评价回答后一次只问一个新问题',
  }[style] || '保持自然对话';
  const prompt = `You are a Japanese conversation tutor speaking with a JLPT ${level} learner whose native language is ${nativeLanguage}. Topic: 「${scene}」.

Rules:
- Use only Japanese and ${explanationLanguage}. Never switch to English unless ${explanationLanguage} is English, even when older context is truncated.
- Reply mainly in Japanese at ${level} level, usually in 1-3 sentences. Ask at most one question, but do not end every turn with a question.
- Treat 「${scene}」 only as the starting setting, never as a required curriculum boundary. If the learner changes the subject or requests another setting, follow immediately and naturally. Never insist on finishing the current topic first or pull the conversation back unless the learner asks.
- Teaching style: ${styleRule}
- ${bilingual ? `Use ${explanationLanguage} only when the learner explicitly asks for help, says they do not understand, or answers entirely in ${explanationLanguage} and needs a bridge. Do not translate every sentence, force repetition, praise every answer, or follow a fixed teaching pattern.` : `Only when the learner asks for help, explain in one sentence of ${explanationLanguage}, then return to Japanese.`}
- Correct only when requested, when meaning is unclear, or when an important error repeats. Otherwise respond to the meaning and keep the conversation natural.
- Output only the tutor reply without a label or translation.
${learningNotes.length ? `\nRecent learning priorities:\n${learningNotes.slice(0, 8).map(item => `- ${item.original || ''} → ${item.better || ''} (${item.note || item.category || ''})`).join('\n')}\nRevisit relevant points naturally without interrupting the conversation.` : ''}

Conversation:
${lines ? lines + '\n' : ''}Learner: ${userMsg}
Tutor reply:`;
  return (await callAI(prompt)).trim();
}

// 结束对话时的结构化学习总结（优缺点 + 可收藏的生词）
export async function freeTalkSummary(scene, level, transcript) {
  const { nativeLanguage, explanationLanguage } = learnerProfile();
  const prompt = `You are a Japanese teacher. Generate a structured review for a ${nativeLanguage}-speaking learner at JLPT ${level}, based on this conversation about 「${scene}」. All explanations, evaluations, meanings, and translations must be in ${explanationLanguage}. Keep Japanese examples in Japanese.

Transcript:
${transcript}

Return only this JSON:
{
  "overall": "2-3 specific, encouraging sentences in ${explanationLanguage}",
  "pros": ["2-3 strengths in ${explanationLanguage}, citing the transcript"],
  "cons": [
    {"category": "issue category in ${explanationLanguage}", "original": "learner's Japanese", "better": "more natural Japanese", "note": "one-sentence explanation in ${explanationLanguage}"}
  ],
  "vocabulary": [
    {"word": "Japanese word or expression", "reading": "よみかた", "meaning": "meaning in ${explanationLanguage}", "example": "Japanese example", "exampleTranslation": "translation in ${explanationLanguage}"}
  ]
}

Include 2-4 cons with a category; if there are no clear mistakes, suggest more advanced phrasing. Include 4-6 useful vocabulary items from the conversation.`;
  return extractJSON(await callAI(prompt));
}

// ---------- 互动模式的 AI 反馈 ----------
export async function getFeedback(targetJapanese, translation, userText) {
  const { nativeLanguage, explanationLanguage } = learnerProfile();
  const prompt = `You are a patient Japanese teacher. A ${nativeLanguage}-speaking learner is role-playing and trying to express a given meaning in Japanese. Evaluate only the learner's Japanese and answer in ${explanationLanguage}.

Meaning to express: ${translation}
Learner's Japanese: ${userText}
Reference line (not the only correct answer): ${targetJapanese}

Answer in 2-4 friendly sentences. Judge whether it expresses the intended meaning correctly and naturally; do not require an exact match. If needed, gently explain grammar or word choice and provide a more natural Japanese sentence. Output only the feedback.`;
  return callAI(prompt);
}

// 无 API Key 时的本地简易反馈
export function localFeedback(targetJapanese, userText) {
  const norm = s => s.replace(/[\s、。！？!?.,，]/g, '');
  const t = norm(targetJapanese), u = norm(userText);
  if (!u) return uiText('没有听到内容，再试一次吧！', 'Nothing was captured. Please try again.');
  if (u === t) return uiText('完全正确！发音和内容都很棒，继续保持！🎉', 'Exactly right! Great pronunciation and content. 🎉');
  let same = 0;
  for (const ch of u) if (t.includes(ch)) same++;
  const ratio = same / Math.max(t.length, 1);
  if (ratio > 0.7) return uiText('非常接近了！和目标句子基本一致，注意个别词的细节即可。', 'Very close! Check just a few word-level details.');
  if (ratio > 0.4) return uiText('有一部分说对了，再对照目标句子多练习几遍吧。', 'Part of it is right. Compare with the model and try a few more times.');
  return uiText('和目标句子差别较大，可以先点击句子听发音，再跟读练习。', 'This differs from the target. Listen to the model first, then shadow it.');
}

// ---------- 演示场景（未配置 API Key 时体验用） ----------
export function demoScenario() {
  const lines = [
    ['店員', 'いらっしゃいませ。こちらへどうぞ。', '欢迎光临。这边请。', 'いらっしゃいませ。こちらへどうぞ。'],
    ['客', 'すみません、おすすめは何ですか。', '请问,有什么推荐的吗?', 'すみません、おすすめは何[なん]ですか。'],
    ['店員', '本日のおすすめは醤油ラーメンです。スープが自慢なんですよ。', '今天的推荐是酱油拉面。我们的汤底是招牌哦。', '本日[ほんじつ]のおすすめは醤油[しょうゆ]ラーメンです。スープが自慢[じまん]なんですよ。'],
    ['客', 'じゃあ、それをお願いします。あと、餃子もひとつ。', '那就要那个吧。另外再来一份饺子。', 'じゃあ、それをお願[ねが]いします。あと、餃子[ぎょうざ]もひとつ。'],
    ['店員', 'かしこまりました。お飲み物はいかがですか。', '好的。请问需要喝的吗?', 'かしこまりました。お飲[の]み物[もの]はいかがですか。'],
    ['客', 'お水で大丈夫です。', '水就可以了。', 'お水[みず]で大丈夫[だいじょうぶ]です。'],
    ['店員', 'はい、少々お待ちください。', '好的,请稍等。', 'はい、少々[しょうしょう]お待[ま]ちください。'],
    ['客', 'すみません、お会計お願いします。', '不好意思,麻烦结账。', 'すみません、お会計[かいけい]お願[ねが]いします。'],
    ['店員', 'お会計は1,200円になります。', '一共是1200日元。', 'お会計[かいけい]は1,200円[えん]になります。'],
    ['客', 'ごちそうさまでした。とても美味しかったです。', '多谢款待。非常好吃。', 'ごちそうさまでした。とても美味[おい]しかったです。'],
  ];
  const vocab = [
    ['いらっしゃいませ', 'いらっしゃいませ', '欢迎光临(店员用语)', 'いらっしゃいませ、何名様ですか。', '欢迎光临,请问几位?'],
    ['おすすめ', 'おすすめ', '推荐', '店員のおすすめを注文しました。', '我点了店员推荐的菜。'],
    ['お会計', 'おかいけい', '结账、买单', 'お会計は別々でお願いします。', '麻烦分开结账。'],
    ['かしこまりました', 'かしこまりました', '好的、明白了(郑重语)', 'かしこまりました。すぐお持ちします。', '明白了,马上给您送来。'],
    ['少々お待ちください', 'しょうしょうおまちください', '请稍等(敬语)', '確認しますので、少々お待ちください。', '我确认一下,请稍等。'],
    ['ごちそうさまでした', 'ごちそうさまでした', '多谢款待(饭后用语)', 'ごちそうさまでした。また来ます。', '多谢款待,我还会再来的。'],
  ];
  return {
    id: crypto.randomUUID(),
    title: 'ラーメン屋で注文する',
    titleChinese: '在拉面店点餐(演示)',
    topic: '在拉面店点餐',
    level: 'N4',
    createdAt: Date.now(),
    favorite: false,
    lines: lines.map(([speaker, japanese, chinese, furigana], i) => ({ orderIndex: i, speaker, japanese, chinese, furigana })),
    vocabulary: vocab.map(([word, reading, meaning, example, exampleChinese]) => ({ word, reading, meaning, example, exampleChinese })),
  };
}
