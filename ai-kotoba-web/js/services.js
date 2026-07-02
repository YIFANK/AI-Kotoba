// AI 服务层：两轮生成策略（第一轮纯日语，第二轮中文翻译），与 macOS 版 ClaudeService/OpenAIService 一致
import { getSettings } from './storage.js';

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
async function callLocal(prompt, settings) {
  let res;
  const engine = settings.localEngine || 'claude';
  const model = engine === 'codex'
    ? (settings.openaiModel || '')
    : (settings.claudeModel || '');
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

async function callAI(prompt) {
  const settings = getSettings();
  if (settings.provider === 'local') return callLocal(prompt, settings);
  return settings.provider === 'openai' ? callOpenAI(prompt, settings) : callClaude(prompt, settings);
}

// ---------- 提示词（对应 Constants.scenarioPromptJapanese / scenarioPromptTranslation） ----------
function promptJapanese(topic, level) {
  return `あなたは経験豊富な日本語教師です。中国語話者の日本語学習者のために、「${topic}」という場面の自然な日本語会話を作成してください。

要件：
- JLPT ${level} レベルに合った語彙と文法を使うこと
- 2人の話者による8〜12行の自然でリアルな会話にすること
- 教科書的な不自然な表現を避け、実際に日本人が使う言い回しにすること
- 会話から学習価値の高い単語・表現を6〜10個選ぶこと

以下のJSON形式のみで出力してください。説明文やその他のテキストは一切不要です：
{
  "title": "会話のタイトル（日本語）",
  "conversation": [
    {"speaker": "話者名", "japanese": "セリフ", "furigana": "同じセリフに、漢字を含む語の直後に読みがなを[ ]で付けた形式。例：私[わたし]は学生[がくせい]です。"}
  ],
  "vocabulary": [
    {"word": "単語", "reading": "よみかた", "example": "例文"}
  ]
}`;
}

function promptTranslation(japaneseJSON) {
  return `下面是一段日语会话的 JSON 数据。请为它添加中文翻译，要求：

1. 给 conversation 数组中每一项添加 "chinese" 字段，内容为该句自然流畅的中文翻译
2. 给 vocabulary 数组中每一项添加 "meaning" 字段（该词的中文意思）和 "exampleChinese" 字段（例句的中文翻译）
3. 添加顶层字段 "titleChinese"（标题的中文翻译），"title" 保持日语不变
4. 不要修改任何日语内容

只输出完整的 JSON，不要任何其他文字或解释：

${JSON.stringify(japaneseJSON, null, 2)}`;
}

// ---------- 两轮场景生成 ----------
export async function generateScenario(topic, level, onStatus) {
  // 第一轮：纯日语生成（避免中日夹杂导致的不自然表达）
  onStatus?.('第一轮：正在生成地道的日语会话…');
  const raw1 = await callAI(promptJapanese(topic, level));
  const japaneseOnly = extractJSON(raw1);
  if (!Array.isArray(japaneseOnly.conversation) || japaneseOnly.conversation.length === 0) {
    throw new Error('AI 返回的会话内容为空，请重试');
  }

  // 第二轮：翻译
  onStatus?.('第二轮：正在添加中文翻译…');
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
    chinese: String(l.chinese || ''),
  })).filter(l => l.japanese);
  const vocabulary = (data.vocabulary || []).map(v => ({
    word: String(v.word || ''),
    reading: String(v.reading || ''),
    meaning: String(v.meaning || ''),
    example: String(v.example || ''),
    exampleChinese: String(v.exampleChinese || ''),
  })).filter(v => v.word);
  return {
    id: crypto.randomUUID(),
    title: String(data.title || topic),
    titleChinese: String(data.titleChinese || ''),
    topic, level,
    createdAt: Date.now(),
    favorite: false,
    lines, vocabulary,
  };
}

// ---------- 阅读文章生成（同样两轮：日语原文 → 中文翻译） ----------
function promptArticleJapanese(request, level) {
  return `あなたは経験豊富な日本語教師です。中国語話者の日本語学習者のために、以下のリクエストに沿った読み物（短い文章）を書いてください。

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
    {"japanese": "段落の本文", "furigana": "同じ本文に、漢字を含む語の直後に読みがなを[ ]で付けた形式。例：私[わたし]は漫画[まんが]が好[す]きです。"}
  ],
  "vocabulary": [
    {"word": "単語", "reading": "よみかた", "example": "例文"}
  ]
}`;
}

function promptArticleTranslation(japaneseJSON) {
  return `下面是一篇日语文章的 JSON 数据。请为它添加中文翻译，要求：

1. 给 paragraphs 数组中每一项添加 "chinese" 字段，内容为该段自然流畅的中文翻译
2. 给 vocabulary 数组中每一项添加 "meaning" 字段（该词的中文意思）和 "exampleChinese" 字段（例句的中文翻译）
3. 添加顶层字段 "titleChinese"（标题的中文翻译），"title" 保持日语不变
4. 不要修改任何日语内容

只输出完整的 JSON，不要任何其他文字或解释：

${JSON.stringify(japaneseJSON, null, 2)}`;
}

export async function generateArticle(request, level, onStatus) {
  onStatus?.('第一轮：正在撰写日语文章…');
  const raw1 = await callAI(promptArticleJapanese(request, level));
  const japaneseOnly = extractJSON(raw1);
  if (!Array.isArray(japaneseOnly.paragraphs) || japaneseOnly.paragraphs.length === 0) {
    throw new Error('AI 返回的文章内容为空，请重试');
  }

  onStatus?.('第二轮：正在添加中文翻译…');
  const raw2 = await callAI(promptArticleTranslation(japaneseOnly));
  const full = extractJSON(raw2);

  const paragraphs = (full.paragraphs || []).map(p => ({
    japanese: String(p.japanese || ''),
    furigana: String(p.furigana || ''),
    chinese: String(p.chinese || ''),
  })).filter(p => p.japanese);
  const vocabulary = (full.vocabulary || []).map(v => ({
    word: String(v.word || ''),
    reading: String(v.reading || ''),
    meaning: String(v.meaning || ''),
    example: String(v.example || ''),
    exampleChinese: String(v.exampleChinese || ''),
  })).filter(v => v.word);
  return {
    id: crypto.randomUUID(),
    title: String(full.title || request),
    titleChinese: String(full.titleChinese || ''),
    request, level,
    createdAt: Date.now(),
    paragraphs, vocabulary,
  };
}

// ---------- 自由对话（文字模式：回合制，走当前 AI 服务） ----------
export function freeTalkInstructions(scene, level) {
  return `あなたは日本語会話パートナーです。「${scene}」という場面で相手役を演じ、中国語話者の日本語学習者（JLPT ${level} 相当）と自由に会話してください。

ルール：
- 常に日本語だけで話すこと（${level} レベルのやさしい語彙・文法で）
- 返事は1〜2文で短くし、質問を返して会話を続けること
- 学習者が間違えたら、正しい言い方を返事の中でさりげなく示すこと（説教しない）
- 学習者が「中文」「помощь」「助けて」など助けを求めたら、一度だけ中国語で簡単にヒントを出してよい`;
}

export async function freeTalkReply(scene, level, history, userMsg) {
  const lines = history.map(h => `${h.role === 'me' ? '学习者' : '你'}：${h.text}`).join('\n');
  const prompt = `你是一位日语会话伙伴，正在和一位 JLPT ${level} 水平的中国学习者进行角色扮演自由对话。场景：「${scene}」。

规则：
- 只用日语回复，语言难度控制在 ${level} 水平
- 回复要短（1〜2 句），并适当反问，让对话自然继续
- 学习者说错时，在你的回复中自然示范正确说法，不要说教、不要中文
- 直接输出日语回复本身，不要任何解释、翻译或前缀

对话记录：
${lines ? lines + '\n' : ''}学习者：${userMsg}
你的日语回复：`;
  return (await callAI(prompt)).trim();
}

export async function freeTalkFeedback(scene, transcript) {
  const prompt = `你是一位日语老师。下面是一位中国学习者（记录中的「我」）在场景「${scene}」中进行日语自由对话的记录。请用中文给出学习点评：

1. 总体表现（1-2 句，以鼓励为主）
2. 指出 2-4 处具体的语法或用词问题，引用原句并给出更自然的说法（如果基本没有错误就明确说明）
3. 推荐 3-5 个本次对话中出现的、值得记住的日语表达

对话记录：
${transcript}

直接输出点评内容，不要前缀。`;
  return callAI(prompt);
}

// ---------- 互动模式的 AI 反馈 ----------
export async function getFeedback(targetJapanese, chinese, userText) {
  const prompt = `你是一位耐心的日语老师。学习者在角色扮演练习中，任务是把一个中文意思用日语说出来。请评价学习者的日语。

【任务：要表达的中文意思】${chinese}
【学习者说出的日语】${userText}
【场景参考台词（仅供对照）】${targetJapanese}

要求（用中文回答，2-4 句话）：
- 只评价【学习者说出的日语】：它是否正确、自然地表达了那个中文意思
- 不必与参考台词逐字一致，意思对、表达地道就应该明确肯定
- 如有语法、用词或不自然之处，温和指出并给出更自然的说法
- 语气友好、鼓励为主，直接输出反馈内容，不要任何前缀或标题`;
  return callAI(prompt);
}

// 无 API Key 时的本地简易反馈
export function localFeedback(targetJapanese, userText) {
  const norm = s => s.replace(/[\s、。！？!?.,，]/g, '');
  const t = norm(targetJapanese), u = norm(userText);
  if (!u) return '没有听到内容，再试一次吧！';
  if (u === t) return '完全正确！发音和内容都很棒，继续保持！🎉';
  let same = 0;
  for (const ch of u) if (t.includes(ch)) same++;
  const ratio = same / Math.max(t.length, 1);
  if (ratio > 0.7) return '非常接近了！和目标句子基本一致，注意个别词的细节即可。';
  if (ratio > 0.4) return '有一部分说对了，再对照目标句子多练习几遍吧。';
  return '和目标句子差别较大，可以先点击句子听发音，再跟读练习。';
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
