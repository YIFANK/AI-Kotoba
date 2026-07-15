// localStorage 持久化层
const KEYS = {
  settings: 'kotoba.settings',
  scenarios: 'kotoba.scenarios',
  vocab: 'kotoba.vocab',
  articles: 'kotoba.articles',
  checkins: 'kotoba.checkins',
  tutorSessions: 'kotoba.tutorSessions',
  learningNotes: 'kotoba.learningNotes',
  pronunciationAttempts: 'kotoba.pronunciationAttempts',
};
const ARTICLE_LIMIT = 50;
const TUTOR_SESSION_LIMIT = 100;
const LEARNING_NOTE_LIMIT = 120;
const PRONUNCIATION_ATTEMPT_LIMIT = 60;

const HISTORY_LIMIT = 100; // 仅非收藏计入上限

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  scheduleSync();
}

// ---------- 服务器同步（server.py 持久化到 data.json，跨浏览器共享） ----------
let syncTimer = null;
let syncAvailable = true; // 纯静态托管时自动降级为仅 localStorage

function snapshot() {
  const out = {};
  for (const [name, key] of Object.entries(KEYS)) {
    out[name] = load(key, name === 'settings' ? {} : []);
  }
  return out;
}
function scheduleSync() {
  if (!syncAvailable) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    fetch('/api/data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshot()),
    }).catch(() => { /* 服务器不可用时静默降级 */ });
  }, 400);
}
function mergeById(a, b, tsKey) {
  const m = new Map();
  for (const x of [...(a || []), ...(b || [])]) {
    if (x && x.id && !m.has(x.id)) m.set(x.id, x);
  }
  return [...m.values()].sort((x, y) => (y[tsKey] || 0) - (x[tsKey] || 0));
}
// 启动时拉取服务器数据并与本地合并（按 id 去重取并集），再回写两边
export async function initSync() {
  let server;
  try {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error();
    server = await res.json();
  } catch {
    syncAvailable = false; // 没有桥接服务（纯静态托管），保持纯本地模式
    return;
  }
  const local = snapshot();
  const merged = {
    settings: Object.keys(local.settings || {}).length ? local.settings : (server.settings || {}),
    scenarios: mergeById(local.scenarios, server.scenarios, 'createdAt'),
    vocab: mergeById(local.vocab, server.vocab, 'addedAt'),
    articles: mergeById(local.articles, server.articles, 'createdAt'),
    checkins: [...new Set([...(local.checkins || []), ...(server.checkins || [])])].sort(),
    tutorSessions: mergeById(local.tutorSessions, server.tutorSessions, 'createdAt'),
    learningNotes: mergeById(local.learningNotes, server.learningNotes, 'updatedAt'),
    pronunciationAttempts: mergeById(local.pronunciationAttempts, server.pronunciationAttempts, 'createdAt'),
  };
  for (const [name, key] of Object.entries(KEYS)) {
    localStorage.setItem(key, JSON.stringify(merged[name]));
  }
  scheduleSync();
}

export function getSettings() {
  const s = Object.assign(
    {
      // 公网版的模型密钥只存在服务端；浏览器统一走 /api/ai。
      provider: 'local', claudeKey: '', openaiKey: '',
      claudeModel: 'claude-sonnet-5', openaiModel: 'gpt-4o',
      openaiFastModel: 'gpt-5.6-luna',
      localEngine: 'openai',
      ttsProvider: 'system', elevenKey: '',
      ttsRate: 0.75,
      // 角色 A / B 双音色（默认 Sarah 女声 / George 男声，多语模型下日语自然）
      elevenVoiceA: 'EXAVITQu4vr4xnSDxMaL',
      elevenVoiceB: 'JBFqnCBsd6RMkjVDRZzb',
      elevenModel: 'eleven_multilingual_v2',
      realtimeVoice: 'marin',
      tutorStyle: 'bilingual',
      showFurigana: true,
      // UI 首版中英双语；内容解释语言与母语允许自由填写。
      uiLanguage: 'zh-CN',
      nativeLanguage: 'Chinese',
      explanationLanguage: 'Simplified Chinese',
      targetLanguage: 'Japanese',
      targetLocale: 'ja-JP',
      levelFramework: 'JLPT',
    },
    load(KEYS.settings, {})
  );
  // 迁移：旧版单一 elevenVoiceId → 音色 A
  if (s.elevenVoiceId && !load(KEYS.settings, {}).elevenVoiceA) s.elevenVoiceA = s.elevenVoiceId;
  return s;
}
export function saveSettings(s) {
  // 密钥去除首尾空白，避免授权失败
  s.claudeKey = (s.claudeKey || '').trim();
  s.openaiKey = (s.openaiKey || '').trim();
  s.elevenKey = (s.elevenKey || '').trim();
  s.nativeLanguage = (s.nativeLanguage || 'Chinese').trim();
  s.explanationLanguage = (s.explanationLanguage || s.nativeLanguage || 'Simplified Chinese').trim();
  s.targetLanguage = 'Japanese';
  s.targetLocale = 'ja-JP';
  s.levelFramework = 'JLPT';
  save(KEYS.settings, s);
}
export function hasAPIKey() {
  const s = getSettings();
  if (s.provider === 'local') return true; // 本地 CLI 免 Key，可用性由桥接服务在调用时报告
  return s.provider === 'claude' ? !!s.claudeKey : !!s.openaiKey;
}

export function getScenarios() {
  return load(KEYS.scenarios, []);
}
export function saveScenario(sc) {
  let list = getScenarios();
  list.unshift(sc);
  save(KEYS.scenarios, enforceLimit(list));
}
export function updateScenario(sc) {
  const list = getScenarios();
  const i = list.findIndex(x => x.id === sc.id);
  if (i >= 0) list[i] = sc;
  save(KEYS.scenarios, list);
}
export function deleteScenario(id) {
  save(KEYS.scenarios, getScenarios().filter(x => x.id !== id));
}
function enforceLimit(list) {
  // 收藏与内置范文不计入 100 条上限，也不会被自动删除
  const others = list.filter(s => !s.favorite && !s.builtin).slice(0, HISTORY_LIMIT);
  return list.filter(s => s.favorite || s.builtin || others.includes(s));
}

// ---------- 内置范文（seed.json，首次启动导入一次） ----------
export async function loadSeeds() {
  const s = getSettings();
  if (s.seedsLoaded) return;
  let seed;
  try {
    const res = await fetch('/ai-kotoba-web/seed.json');
    if (!res.ok) return;
    seed = await res.json();
  } catch {
    return; // 没有 seed 文件或加载失败，跳过
  }
  const scenarios = getScenarios();
  const scIds = new Set(scenarios.map(x => x.id));
  save(KEYS.scenarios, [...scenarios, ...(seed.scenarios || []).filter(x => !scIds.has(x.id))]);
  const articles = getArticles();
  const artIds = new Set(articles.map(x => x.id));
  save(KEYS.articles, [...articles, ...(seed.articles || []).filter(x => !artIds.has(x.id))]);
  saveSettings(Object.assign(getSettings(), { seedsLoaded: true }));
}

export function getVocab() {
  return load(KEYS.vocab, []);
}
export function saveVocabList(list) {
  save(KEYS.vocab, list);
}
export function addVocab(item) {
  const list = getVocab();
  if (list.some(v => v.word === item.word)) return false;
  list.unshift(Object.assign({
    id: crypto.randomUUID(),
    addedAt: Date.now(),
    ease: 2.5, interval: 0, reps: 0,
    nextReview: Date.now(), // 立即可复习
  }, item));
  save(KEYS.vocab, list);
  return true;
}
export function deleteVocab(id) {
  save(KEYS.vocab, getVocab().filter(v => v.id !== id));
}
export function updateVocab(item) {
  const list = getVocab();
  const i = list.findIndex(v => v.id === item.id);
  if (i >= 0) list[i] = item;
  save(KEYS.vocab, list);
}

// ---------- Tutor 课程与长期学习记忆 ----------
export function getTutorSessions() {
  return load(KEYS.tutorSessions, []);
}
export function saveTutorSession(session) {
  const list = getTutorSessions().filter(item => item.id !== session.id);
  list.unshift(session);
  save(KEYS.tutorSessions, list.slice(0, TUTOR_SESSION_LIMIT));
}
export function getLearningNotes(limit) {
  const list = load(KEYS.learningNotes, [])
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return Number.isFinite(limit) ? list.slice(0, Math.max(0, limit)) : list;
}
export function addLearningNote(input) {
  const clean = (value, max) => String(value || '').trim().slice(0, max);
  const note = {
    category: clean(input.category, 24) || '自然表达',
    original: clean(input.original, 160),
    better: clean(input.better, 160),
    note: clean(input.note, 240),
    source: clean(input.source, 32) || 'tutor',
  };
  if (!note.original && !note.better && !note.note) return { created: false, note: null };

  const list = getLearningNotes();
  const key = `${note.category}|${note.original}|${note.better}`.toLocaleLowerCase();
  const index = list.findIndex(item =>
    `${item.category || ''}|${item.original || ''}|${item.better || ''}`.toLocaleLowerCase() === key
  );
  const now = Date.now();
  if (index >= 0) {
    list[index] = Object.assign({}, list[index], note, {
      updatedAt: now,
      seenCount: (list[index].seenCount || 1) + 1,
    });
    const updated = list.splice(index, 1)[0];
    list.unshift(updated);
    save(KEYS.learningNotes, list.slice(0, LEARNING_NOTE_LIMIT));
    return { created: false, note: updated };
  }

  const created = Object.assign({
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    seenCount: 1,
  }, note);
  list.unshift(created);
  save(KEYS.learningNotes, list.slice(0, LEARNING_NOTE_LIMIT));
  return { created: true, note: created };
}

// ---------- 发音诊断 ----------
export function getPronunciationAttempts(limit) {
  const list = load(KEYS.pronunciationAttempts, [])
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return Number.isFinite(limit) ? list.slice(0, Math.max(0, limit)) : list;
}
export function savePronunciationAttempt(attempt) {
  const list = getPronunciationAttempts().filter(item => item.id !== attempt.id);
  list.unshift(attempt);
  save(KEYS.pronunciationAttempts, list.slice(0, PRONUNCIATION_ATTEMPT_LIMIT));
}

// ---------- 阅读文章 ----------
export function getArticles() {
  return load(KEYS.articles, []);
}
export function saveArticle(a) {
  const list = getArticles();
  list.unshift(a);
  save(KEYS.articles, list.slice(0, ARTICLE_LIMIT));
}
export function deleteArticle(id) {
  save(KEYS.articles, getArticles().filter(x => x.id !== id));
}
export function updateArticle(a) {
  const list = getArticles();
  const i = list.findIndex(x => x.id === a.id);
  if (i >= 0) list[i] = a;
  save(KEYS.articles, list);
}

// ---------- 每日签到 ----------
function localDateStr(d = new Date()) {
  return d.toLocaleDateString('sv'); // YYYY-MM-DD（本地时区）
}
export function getCheckins() {
  return load(KEYS.checkins, []);
}
// 任何学习行为都会触发签到；返回 true 表示这是今天第一次
export function recordActivity() {
  const today = localDateStr();
  const list = getCheckins();
  if (list.includes(today)) return false;
  list.push(today);
  save(KEYS.checkins, list);
  return true;
}
export function streakInfo() {
  const set = new Set(getCheckins());
  const today = localDateStr();
  const d = new Date();
  if (!set.has(today)) d.setDate(d.getDate() - 1); // 今天还没签到时，连续天数从昨天往回数
  let streak = 0;
  while (set.has(localDateStr(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  // 最近 7 天（含今天），用于周视图
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const w = new Date();
    w.setDate(w.getDate() - i);
    week.push({ date: localDateStr(w), day: '日一二三四五六'[w.getDay()], done: set.has(localDateStr(w)) });
  }
  return { streak, total: set.size, todayDone: set.has(today), week };
}

export function exportAll() {
  return JSON.stringify({
    scenarios: getScenarios(),
    vocab: getVocab(),
    articles: getArticles(),
    checkins: getCheckins(),
    tutorSessions: getTutorSessions(),
    learningNotes: getLearningNotes(),
    pronunciationAttempts: getPronunciationAttempts(),
    exportedAt: new Date().toISOString(),
  }, null, 2);
}
export function importAll(json) {
  const data = JSON.parse(json);
  if (!Array.isArray(data.scenarios) || !Array.isArray(data.vocab)) {
    throw new Error('文件格式不正确');
  }
  save(KEYS.scenarios, data.scenarios);
  save(KEYS.vocab, data.vocab);
  if (Array.isArray(data.articles)) save(KEYS.articles, data.articles);
  if (Array.isArray(data.checkins)) save(KEYS.checkins, data.checkins);
  if (Array.isArray(data.tutorSessions)) save(KEYS.tutorSessions, data.tutorSessions);
  if (Array.isArray(data.learningNotes)) save(KEYS.learningNotes, data.learningNotes);
  if (Array.isArray(data.pronunciationAttempts)) save(KEYS.pronunciationAttempts, data.pronunciationAttempts);
}
export function clearAll() {
  localStorage.removeItem(KEYS.scenarios);
  localStorage.removeItem(KEYS.vocab);
  localStorage.removeItem(KEYS.articles);
  localStorage.removeItem(KEYS.checkins);
  localStorage.removeItem(KEYS.tutorSessions);
  localStorage.removeItem(KEYS.learningNotes);
  localStorage.removeItem(KEYS.pronunciationAttempts);
}
