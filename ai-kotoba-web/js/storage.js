// localStorage 持久化层
const KEYS = {
  settings: 'kotoba.settings',
  scenarios: 'kotoba.scenarios',
  vocab: 'kotoba.vocab',
};

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
}

export function getSettings() {
  return Object.assign(
    {
      provider: 'claude', claudeKey: '', openaiKey: '',
      claudeModel: 'claude-sonnet-5', openaiModel: 'gpt-4o',
      ttsProvider: 'system', elevenKey: '',
      elevenVoiceId: '21m00Tcm4TlvDq8ikWAM',
      elevenModel: 'eleven_multilingual_v2',
    },
    load(KEYS.settings, {})
  );
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

export function exportAll() {
  return JSON.stringify({
    scenarios: getScenarios(),
    vocab: getVocab(),
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
}
export function clearAll() {
  localStorage.removeItem(KEYS.scenarios);
  localStorage.removeItem(KEYS.vocab);
}
