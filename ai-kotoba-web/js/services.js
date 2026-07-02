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

async function callAI(prompt) {
  const settings = getSettings();
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
    {"speaker": "話者名", "japanese": "セリフ"}
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

// ---------- 互动模式的 AI 反馈 ----------
export async function getFeedback(targetJapanese, userText) {
  const prompt = `你是一位耐心的日语老师。学习者在角色扮演练习中，需要说出这句日语台词：
「${targetJapanese}」

学习者实际说出/输入的内容是：
「${userText}」

请用中文给出简短反馈（2-3 句话）：
- 如果基本一致或意思正确，请肯定并表扬
- 如果有用词、语法或表达问题，请温和地指出并给出正确说法
- 语气友好、鼓励为主，直接输出反馈内容，不要任何前缀`;
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
    ['店員', 'いらっしゃいませ。こちらへどうぞ。', '欢迎光临。这边请。'],
    ['客', 'すみません、おすすめは何ですか。', '请问,有什么推荐的吗?'],
    ['店員', '本日のおすすめは醤油ラーメンです。スープが自慢なんですよ。', '今天的推荐是酱油拉面。我们的汤底是招牌哦。'],
    ['客', 'じゃあ、それをお願いします。あと、餃子もひとつ。', '那就要那个吧。另外再来一份饺子。'],
    ['店員', 'かしこまりました。お飲み物はいかがですか。', '好的。请问需要喝的吗?'],
    ['客', 'お水で大丈夫です。', '水就可以了。'],
    ['店員', 'はい、少々お待ちください。', '好的,请稍等。'],
    ['客', 'すみません、お会計お願いします。', '不好意思,麻烦结账。'],
    ['店員', 'お会計は1,200円になります。', '一共是1200日元。'],
    ['客', 'ごちそうさまでした。とても美味しかったです。', '多谢款待。非常好吃。'],
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
    lines: lines.map(([speaker, japanese, chinese], i) => ({ orderIndex: i, speaker, japanese, chinese })),
    vocabulary: vocab.map(([word, reading, meaning, example, exampleChinese]) => ({ word, reading, meaning, example, exampleChinese })),
  };
}
