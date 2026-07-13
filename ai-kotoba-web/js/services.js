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

async function callOpenAI(prompt, settings) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${settings.openaiKey}`,
    },
    body: JSON.stringify({
      model: settings.openaiModel || 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
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
  const engine = settings.localEngine || 'claude';
  let model = engine === 'codex'
    ? (settings.openaiModel || '')
    : (settings.claudeModel || '');
  // fast：轻量任务（如助教答疑）用小模型提速；仅 claude 引擎支持别名
  if (opts.fast && engine === 'claude') model = 'haiku';
  try {
    res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, engine, model }),
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
  return settings.provider === 'openai' ? callOpenAI(prompt, settings) : callClaude(prompt, settings);
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

// ---------- 提示词（对应 Constants.scenarioPromptJapanese / scenarioPromptTranslation） ----------
function promptJapanese(topic, level) {
  const { nativeLanguage } = learnerProfile();
  return `あなたは経験豊富な日本語教師です。母語が「${nativeLanguage}」の日本語学習者のために、「${topic}」という場面の自然な日本語会話を作成してください。

要件：
- JLPT ${level} レベルに合った語彙と文法を使うこと
- 2人の話者による8〜12行の自然でリアルな会話にすること
- 教科書的な不自然な表現を避け、実際に日本人が使う言い回しにすること
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

  return normalizeScenario(full, topic, level);
}

function normalizeScenario(data, topic, level) {
  const lines = (data.conversation || []).map((l, i) => ({
    orderIndex: i,
    speaker: String(l.speaker || (i % 2 === 0 ? 'A' : 'B')),
    japanese: String(l.japanese || ''),
    furigana: String(l.furigana || ''),
    translation: String(l.translation || l.chinese || ''),
  })).filter(l => l.japanese);
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

  const paragraphs = (full.paragraphs || []).map(p => ({
    japanese: String(p.japanese || ''),
    furigana: String(p.furigana || ''),
    translation: String(p.translation || p.chinese || ''),
  })).filter(p => p.japanese);
  const vocabulary = (full.vocabulary || []).map(v => ({
    word: String(v.word || ''),
    reading: String(v.reading || ''),
    meaning: String(v.meaning || ''),
    example: String(v.example || ''),
    exampleTranslation: String(v.exampleTranslation || v.exampleChinese || ''),
  })).filter(v => v.word);
  return {
    id: crypto.randomUUID(),
    title: String(full.title || request),
    localizedTitle: String(full.localizedTitle || full.titleChinese || ''),
    translationLanguage: learnerProfile().explanationLanguage,
    request, level,
    createdAt: Date.now(),
    paragraphs, vocabulary,
  };
}

// ---------- AI Tutor（文字模式与 Realtime 共用教学策略） ----------
function learningMemoryBlock(learningNotes = []) {
  const notes = learningNotes.slice(0, 8).map(item => {
    const correction = [item.original, item.better].filter(Boolean).join(' → ');
    return `- [${item.category || '学习重点'}] ${correction}${item.note ? `（${item.note}）` : ''}`;
  });
  return notes.length ? `\n\nこの学習者の最近の重点項目：\n${notes.join('\n')}\n会話の流れを壊さない範囲で、これらを自然に再確認してください。` : '';
}

export function freeTalkInstructions(scene, level, style = 'conversation', learningNotes = []) {
  const { nativeLanguage, explanationLanguage } = learnerProfile();
  const styleRule = {
    conversation: '会話の流れを最優先し、小さな間違いは止めすぎない。重要な間違いだけ自然な言い換えで示す',
    correction: '学習者の発話にまず内容で反応し、その後「より自然には〜」の形で重要な誤りを一つだけ短く直す',
    interview: '日本語の口頭試験官として、一問ずつ質問する。回答を短く評価してから次の質問へ進む',
  }[style] || '自然な会話を続ける';
  return `あなたは、母語が「${nativeLanguage}」の学習者のための、親切で会話上手な日本語音声チューターです。「${scene}」というテーマで、JLPT ${level} 相当の学習者とレッスンをしてください。説明が必要な場合は「${explanationLanguage}」を使ってください。

指導方針：${styleRule}。

会話ルール：
- 基本は自然な日本語で話し、語彙・文法・速度を ${level} に合わせる
- 一度に質問は一つだけ。返答は通常2〜3文以内にし、学習者が話す時間を多く取る
- 意味が通じたらまず内容に反応し、細かすぎる訂正で会話を止めない
- 訂正では必ず自然な日本語の完成文を示す。${explanationLanguage} の説明は必要なときだけ一文にする
- 発音について聞かれたら、かな表記と口の動かし方・アクセントの短いヒントを出す
- 学習者が助けを求めた場合は ${explanationLanguage} で短く助け、その後日本語へ戻る
- 教科書の朗読ではなく、現実の会話として話題を少しずつ発展させる
- 学習者が表現の保存や弱点の記録を明確に頼んだ場合だけ、利用可能な保存ツールを使う${learningMemoryBlock(learningNotes)}`;
}

export async function freeTalkReply(scene, level, history, userMsg, style = 'conversation', learningNotes = []) {
  const { nativeLanguage, explanationLanguage } = learnerProfile();
  const lines = history.map(h => `${h.role === 'me' ? 'Learner' : 'Tutor'}: ${h.text}`).join('\n');
  const styleRule = {
    conversation: '优先保持自然对话，只纠正影响理解或很不自然的错误',
    correction: '先回应内容，再用「より自然には〜」只纠正一个最重要的问题',
    interview: '像日语口试考官一样，简短评价回答后一次只问一个新问题',
  }[style] || '保持自然对话';
  const prompt = `You are a Japanese conversation tutor speaking with a JLPT ${level} learner whose native language is ${nativeLanguage}. Topic: 「${scene}」.

Rules:
- Reply mainly in Japanese at ${level} level, in 2-3 sentences, with only one question at a time.
- Teaching style: ${styleRule}
- Only when the learner asks for help, explain in one sentence of ${explanationLanguage}, then return to Japanese.
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
