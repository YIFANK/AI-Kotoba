// localStorage 持久化层
const KEYS = {
  settings: 'kotoba.settings',
  scenarios: 'kotoba.scenarios',
  vocab: 'kotoba.vocab',
  articles: 'kotoba.articles',
  checkins: 'kotoba.checkins',
};
const ARTICLE_LIMIT = 50;

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
  };
  for (const [name, key] of Object.entries(KEYS)) {
    localStorage.setItem(key, JSON.stringify(merged[name]));
  }
  scheduleSync();
}

export function getSettings() {
  const s = Object.assign(
    {
      provider: 'claude', claudeKey: '', openaiKey: '',
      claudeModel: 'claude-sonnet-5', openaiModel: 'gpt-4o',
      localEngine: 'claude',
      ttsProvider: 'system', elevenKey: '',
      // 角色 A / B 双音色（默认 Sarah 女声 / George 男声，多语模型下日语自然）
      elevenVoiceA: 'EXAVITQu4vr4xnSDxMaL',
      elevenVoiceB: 'JBFqnCBsd6RMkjVDRZzb',
      elevenModel: 'eleven_multilingual_v2',
      showFurigana: true,
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
  // 收藏不计入 100 条上限，也不会被自动删除
  const favorites = list.filter(s => s.favorite);
  const others = list.filter(s => !s.favorite).slice(0, HISTORY_LIMIT);
  return list.filter(s => s.favorite || others.includes(s));
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
}
export function clearAll() {
  localStorage.removeItem(KEYS.scenarios);
  localStorage.removeItem(KEYS.vocab);
  localStorage.removeItem(KEYS.articles);
  localStorage.removeItem(KEYS.checkins);
}
