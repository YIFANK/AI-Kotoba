import * as db from './storage.js';
import { generateScenario, demoScenario, getFeedback, localFeedback } from './services.js';
import { speak, stopSpeaking, sttSupported, createRecognizer } from './speech.js';
import { applySM2, isDue, formatDue } from './srs.js';

const view = document.getElementById('view');
let currentTab = 'practice';
let lastScenario = null; // 练习页最近生成的场景

// ---------- 工具 ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
function fmtDate(ts) {
  return new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const ICONS = {
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9L12 3.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0l-.8 12a2 2 0 0 1-2 1.9H8.8a2 2 0 0 1-2-1.9L6 7"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M11 5L6.5 9H3v6h3.5L11 19V5z"/><path d="M15 9.3a4 4 0 0 1 0 5.4M17.7 6.6a8 8 0 0 1 0 10.8"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5-11-6.5z"/></svg>',
};

// ---------- Tab 切换 ----------
const TABS = { practice: renderPractice, history: () => renderHistory(false), favorites: () => renderHistory(true), vocab: renderVocab, cards: renderCards, settings: renderSettings };

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
function switchTab(tab) {
  currentTab = tab;
  stopSpeaking();
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  TABS[tab]();
  view.scrollTop = 0;
  document.querySelector('.main').scrollTop = 0;
}

// ==================== 练习（生成） ====================
const PRESETS = ['在餐厅点餐', '便利店购物', '问路', '酒店入住', '在车站买票', '看医生', '打工面试', '和朋友约饭', '快递取件', '道歉与感谢'];

function renderPractice() {
  view.innerHTML = `
    <h1 class="page-title">练习</h1>
    <p class="page-sub">输入一个场景，AI 会先生成地道的日语会话，再补充中文翻译（两轮生成，避免中日夹杂的不自然表达）</p>
    <div class="card">
      <label class="field-label">场景主题</label>
      <div class="gen-row">
        <input type="text" id="topic-input" placeholder="例如：在拉面店点餐" maxlength="60">
        <select id="level-select">
          ${['N5', 'N4', 'N3', 'N2', 'N1'].map(l => `<option ${l === 'N4' ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <button class="btn primary" id="gen-btn">✨ 生成会话</button>
      </div>
      <div class="chips">
        ${PRESETS.map(p => `<button class="chip" data-topic="${esc(p)}">${esc(p)}</button>`).join('')}
      </div>
      <div id="gen-status"></div>
    </div>
    <div id="gen-result" style="margin-top:20px"></div>
  `;
  const input = view.querySelector('#topic-input');
  view.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { input.value = c.dataset.topic; }));
  view.querySelector('#gen-btn').addEventListener('click', onGenerate);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') onGenerate(); });

  if (lastScenario) {
    renderScenarioDetail(lastScenario, view.querySelector('#gen-result'));
  }
}

async function onGenerate() {
  const input = view.querySelector('#topic-input');
  const topic = input.value.trim();
  const level = view.querySelector('#level-select').value;
  const status = view.querySelector('#gen-status');
  const btn = view.querySelector('#gen-btn');
  if (!topic) { toast('请先输入场景主题'); input.focus(); return; }

  btn.disabled = true;
  try {
    let scenario;
    if (!db.hasAPIKey()) {
      status.innerHTML = `<div class="gen-status"><div class="spinner"></div>未配置 API Key，正在加载演示会话…</div>`;
      await new Promise(r => setTimeout(r, 600));
      scenario = demoScenario();
      toast('这是演示会话。在「设置」中配置 API Key 后即可自由生成');
    } else {
      scenario = await generateScenario(topic, level, msg => {
        status.innerHTML = `<div class="gen-status"><div class="spinner"></div>${esc(msg)}</div>`;
      });
    }
    db.saveScenario(scenario);
    lastScenario = scenario;
    status.innerHTML = '';
    renderScenarioDetail(scenario, view.querySelector('#gen-result'));
    view.querySelector('#gen-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    status.innerHTML = `<div class="gen-status" style="color:#d3455b">生成失败：${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

// ==================== 会话详情（普通模式） ====================
function speakerParity(sc, speaker, index) {
  return index % 2 === 0 ? 'a' : 'b'; // 按 orderIndex 奇偶判定角色，而非说话人名字
}

function renderScenarioDetail(sc, container, opts = {}) {
  const vocabWords = new Set(db.getVocab().map(v => v.word));
  container.innerHTML = `
    ${opts.backTab ? `<div class="back-row"><button class="btn small" id="back-btn">${ICONS.back} 返回</button></div>` : ''}
    <div class="card">
      <div class="scenario-head">
        <div>
          <div class="scenario-title jp">${esc(sc.title)}</div>
          ${sc.titleChinese ? `<div class="scenario-title-cn">${esc(sc.titleChinese)}</div>` : ''}
          <div class="scenario-meta">
            <span class="tag level">JLPT ${esc(sc.level)}</span>
            <span class="tag">${esc(sc.topic)}</span>
            <span class="tag">${fmtDate(sc.createdAt)}</span>
          </div>
        </div>
        <div class="scenario-actions">
          <button class="icon-btn ${sc.favorite ? 'starred' : ''}" id="fav-btn" title="收藏">${ICONS.star}</button>
          <button class="btn primary" id="interactive-btn">🎭 互动模式</button>
        </div>
      </div>
      <div class="lines" id="lines">
        ${sc.lines.map((l, i) => `
          <div class="line" data-i="${i}" title="点击朗读">
            <span class="badge ${speakerParity(sc, l.speaker, i)}">${esc(l.speaker)}</span>
            <div class="line-body">
              <p class="line-jp jp">${esc(l.japanese)}</p>
              <p class="line-cn">${esc(l.chinese)}</p>
            </div>
            <span class="line-speak">${ICONS.speaker}</span>
          </div>`).join('')}
      </div>
      <div class="section-title">📖 生词建议</div>
      <div class="vocab-grid">
        ${sc.vocabulary.map((v, i) => `
          <div class="vocab-card">
            <div class="vocab-word jp">${esc(v.word)}</div>
            <div class="vocab-reading jp">${esc(v.reading)}</div>
            <div class="vocab-meaning">${esc(v.meaning)}</div>
            ${v.example ? `<div class="vocab-example jp">${esc(v.example)}${v.exampleChinese ? `<br><span style="font-family:inherit">${esc(v.exampleChinese)}</span>` : ''}</div>` : ''}
            <button class="btn small soft add-vocab" data-i="${i}" ${vocabWords.has(v.word) ? 'disabled' : ''}>${vocabWords.has(v.word) ? '已在生词本' : '+ 加入生词本'}</button>
          </div>`).join('')}
      </div>
    </div>
  `;

  if (opts.backTab) container.querySelector('#back-btn').addEventListener('click', () => switchTab(opts.backTab));

  container.querySelectorAll('.line').forEach(el => {
    el.addEventListener('click', () => {
      const line = sc.lines[+el.dataset.i];
      container.querySelectorAll('.line').forEach(x => x.classList.remove('playing'));
      el.classList.add('playing');
      speak(line.japanese, () => el.classList.remove('playing'));
    });
  });

  container.querySelector('#fav-btn').addEventListener('click', (e) => {
    sc.favorite = !sc.favorite;
    db.updateScenario(sc);
    e.currentTarget.classList.toggle('starred', sc.favorite);
    toast(sc.favorite ? '已收藏（不计入历史上限）' : '已取消收藏');
  });

  container.querySelectorAll('.add-vocab').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = sc.vocabulary[+btn.dataset.i];
      if (db.addVocab(v)) {
        btn.disabled = true;
        btn.textContent = '已在生词本';
        toast(`「${v.word}」已加入生词本`);
      }
    });
  });

  container.querySelector('#interactive-btn').addEventListener('click', () => renderCharacterSelection(sc, opts));
}

// ==================== 互动模式 ====================
function renderCharacterSelection(sc, opts = {}) {
  stopSpeaking();
  const nameA = sc.lines[0]?.speaker || 'A';
  const nameB = sc.lines.find((_, i) => i % 2 === 1)?.speaker || 'B';
  view.innerHTML = `
    <div class="back-row"><button class="btn small" id="back-btn">${ICONS.back} 返回会话</button></div>
    <h1 class="page-title">选择你的角色</h1>
    <p class="page-sub">你将扮演所选角色，说出（或输入）对应台词，AI 会给出反馈</p>
    <div class="card">
      <div class="scenario-title jp" style="font-size:17px">${esc(sc.title)}</div>
      <div class="role-cards">
        <button class="role-card" data-role="A">
          <div class="emoji">🙋</div>
          <div class="name jp">${esc(nameA)}</div>
          <div class="desc">扮演角色 A（第 1、3、5… 句）</div>
        </button>
        <button class="role-card" data-role="B">
          <div class="emoji">🙋‍♀️</div>
          <div class="name jp">${esc(nameB)}</div>
          <div class="desc">扮演角色 B（第 2、4、6… 句）</div>
        </button>
        <button class="role-card" data-role="both">
          <div class="emoji">🎭</div>
          <div class="name">双方都扮演</div>
          <div class="desc">练习所有台词，挑战最大</div>
        </button>
      </div>
    </div>
  `;
  view.querySelector('#back-btn').addEventListener('click', () => renderScenarioDetail(sc, view, opts));
  view.querySelectorAll('.role-card').forEach(c => {
    c.addEventListener('click', () => startInteractive(sc, c.dataset.role, opts));
  });
}

function isUserTurn(role, index) {
  // 按 orderIndex 奇偶判定（说话人名字可能不一致，如「田中」vs「田中（友人A）」）
  if (role === 'both') return true;
  return index % 2 === 0 ? role === 'A' : role === 'B';
}

function startInteractive(sc, role, opts = {}) {
  const session = { idx: 0, completed: 0, userLines: 0 };
  let recognizer = null, recording = false;

  view.innerHTML = `
    <div class="back-row"><button class="btn small" id="exit-btn">${ICONS.back} 退出互动模式</button></div>
    <h1 class="page-title jp" style="font-size:19px">${esc(sc.title)}</h1>
    <div class="progress-track"><div class="progress-fill" id="progress" style="width:0%"></div></div>
    <div class="chat" id="chat"></div>
    <div id="panel"></div>
  `;
  const chat = view.querySelector('#chat');
  const panel = view.querySelector('#panel');
  view.querySelector('#exit-btn').addEventListener('click', () => {
    stopSpeaking();
    recognizer?.stop();
    renderScenarioDetail(sc, view, opts);
  });

  function updateProgress() {
    view.querySelector('#progress').style.width = `${(session.idx / sc.lines.length) * 100}%`;
  }

  function appendBubble(line, i, mine) {
    const row = document.createElement('div');
    row.className = `bubble-row ${mine ? 'me' : ''}`;
    row.innerHTML = `
      <span class="avatar ${speakerParity(sc, line.speaker, i)}">${esc(line.speaker.slice(0, 2))}</span>
      <div class="bubble" title="点击朗读">
        <div class="line-jp jp" style="font-size:15px">${esc(line.japanese)}</div>
        <div class="line-cn">${esc(line.chinese)}</div>
      </div>`;
    row.querySelector('.bubble').addEventListener('click', () => speak(line.japanese));
    chat.appendChild(row);
    row.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  function appendFeedback(text) {
    const row = document.createElement('div');
    row.className = 'bubble-row';
    row.innerHTML = `<div class="bubble feedback"><div class="feedback-label">💬 AI 反馈</div>${esc(text)}</div>`;
    chat.appendChild(row);
    row.scrollIntoView({ behavior: 'smooth', block: 'end' });
    return row;
  }

  function step() {
    updateProgress();
    // 自动播放 AI 的台词，直到轮到用户
    while (session.idx < sc.lines.length && !isUserTurn(role, session.idx)) {
      const i = session.idx;
      appendBubble(sc.lines[i], i, false);
      speak(sc.lines[i].japanese);
      session.idx++;
    }
    updateProgress();
    if (session.idx >= sc.lines.length) return renderComplete();
    renderUserPanel();
  }

  function renderUserPanel() {
    const i = session.idx;
    const line = sc.lines[i];
    const supported = sttSupported();
    panel.innerHTML = `
      <div class="user-panel">
        <div class="turn-label">🎤 轮到你了！请说出这句台词（扮演 ${esc(line.speaker)}）：</div>
        <div class="target-line jp">${esc(line.japanese)}</div>
        <div class="target-cn hidden-cn" id="target-cn" title="点击显示中文">${esc(line.chinese)}</div>
        <div class="input-row">
          <button class="mic-btn" id="mic-btn" title="${supported ? '语音输入（日语）' : '当前浏览器不支持语音识别，请使用 Chrome/Edge/Safari'}" ${supported ? '' : 'disabled style="opacity:.4"'}>${ICONS.mic}</button>
          <input type="text" id="user-input" placeholder="${supported ? '点击麦克风说日语，或直接输入…' : '请输入日语…'}" autocomplete="off">
          <button class="btn primary" id="submit-btn">提交</button>
          <button class="btn" id="listen-btn" title="听示范发音">${ICONS.speaker}</button>
        </div>
      </div>
    `;
    panel.querySelector('#target-cn').addEventListener('click', e => e.currentTarget.classList.remove('hidden-cn'));
    panel.querySelector('#listen-btn').addEventListener('click', () => speak(line.japanese));
    const input = panel.querySelector('#user-input');
    input.focus();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    panel.querySelector('#submit-btn').addEventListener('click', submit);

    const micBtn = panel.querySelector('#mic-btn');
    if (supported) {
      micBtn.addEventListener('click', () => {
        if (recording) { recognizer?.stop(); return; }
        recognizer = createRecognizer({
          onResult: (text) => { input.value = text; },
          onEnd: () => { recording = false; micBtn.classList.remove('recording'); },
          onError: (err) => {
            recording = false; micBtn.classList.remove('recording');
            if (err !== 'aborted' && err !== 'no-speech') toast(`语音识别出错：${err}（请检查麦克风权限）`);
          },
        });
        recognizer.start();
        recording = true;
        micBtn.classList.add('recording');
      });
    }

    async function submit() {
      const text = input.value.trim();
      if (!text) { toast('请先说出或输入台词'); return; }
      recognizer?.stop();
      panel.innerHTML = '';
      appendBubble(Object.assign({}, line, { japanese: text, chinese: '（你的回答）' }), i, true);
      session.userLines++;

      const fbRow = appendFeedback('正在点评…');
      let fb;
      try {
        fb = db.hasAPIKey() ? await getFeedback(line.japanese, text) : localFeedback(line.japanese, text);
      } catch {
        fb = localFeedback(line.japanese, text);
      }
      fbRow.querySelector('.bubble').innerHTML = `<div class="feedback-label">💬 AI 反馈</div>${esc(fb)}`;

      panel.innerHTML = `
        <div style="display:flex;gap:10px;margin-top:16px;justify-content:center">
          <button class="btn" id="ref-btn">${ICONS.speaker} 听标准答案</button>
          <button class="btn primary" id="next-btn">下一句 →</button>
        </div>`;
      panel.querySelector('#ref-btn').addEventListener('click', () => speak(line.japanese));
      panel.querySelector('#next-btn').addEventListener('click', () => {
        session.idx++;
        session.completed++;
        panel.innerHTML = '';
        step();
      });
      panel.querySelector('#next-btn').focus();
    }
  }

  function renderComplete() {
    const vocabWords = new Set(db.getVocab().map(v => v.word));
    panel.innerHTML = `
      <div class="card" style="margin-top:20px">
        <div class="complete-banner">
          <div class="big">🎉</div>
          <h3>会话完成！</h3>
          <p>你完成了 ${session.userLines} 句台词的角色扮演练习</p>
        </div>
        <div class="section-title">📖 复习本场景的生词</div>
        <div class="vocab-grid">
          ${sc.vocabulary.map((v, i) => `
            <div class="vocab-card">
              <div class="vocab-word jp">${esc(v.word)}</div>
              <div class="vocab-reading jp">${esc(v.reading)}</div>
              <div class="vocab-meaning">${esc(v.meaning)}</div>
              <button class="btn small soft add-vocab" data-i="${i}" ${vocabWords.has(v.word) ? 'disabled' : ''}>${vocabWords.has(v.word) ? '已在生词本' : '+ 加入生词本'}</button>
            </div>`).join('')}
        </div>
        <div style="text-align:center;margin-top:22px">
          <button class="btn primary" id="done-btn">返回会话</button>
        </div>
      </div>`;
    panel.querySelectorAll('.add-vocab').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = sc.vocabulary[+btn.dataset.i];
        if (db.addVocab(v)) { btn.disabled = true; btn.textContent = '已在生词本'; toast(`「${v.word}」已加入生词本`); }
      });
    });
    panel.querySelector('#done-btn').addEventListener('click', () => renderScenarioDetail(sc, view, opts));
    panel.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  step();
}

// ==================== 历史 / 收藏 ====================
function renderHistory(favoritesOnly) {
  const all = db.getScenarios();
  const list = favoritesOnly ? all.filter(s => s.favorite) : all;
  const title = favoritesOnly ? '收藏' : '历史';
  view.innerHTML = `
    <h1 class="page-title">${title}</h1>
    <p class="page-sub">${favoritesOnly ? '收藏的会话不计入 100 条历史上限，不会被自动清理' : `共 ${list.length} 条会话（非收藏最多保留 100 条）`}</p>
    <div class="list" id="list"></div>
  `;
  const listEl = view.querySelector('#list');
  if (list.length === 0) {
    listEl.innerHTML = `<div class="empty"><div class="big">${favoritesOnly ? '⭐' : '🗂️'}</div><p>${favoritesOnly ? '还没有收藏的会话，点击会话中的星星即可收藏' : '还没有会话记录，去「练习」生成第一个吧'}</p></div>`;
    return;
  }
  for (const sc of list) {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <span class="badge a" style="min-width:38px;height:38px;border-radius:11px;font-size:15px" >${esc((sc.title || '会')[0])}</span>
      <div class="list-item-body">
        <div class="list-item-title jp">${esc(sc.title)}</div>
        <div class="list-item-sub">${sc.titleChinese ? esc(sc.titleChinese) + ' · ' : ''}JLPT ${esc(sc.level)} · ${sc.lines.length} 句 · ${fmtDate(sc.createdAt)}</div>
      </div>
      <div class="list-item-actions">
        <button class="icon-btn ${sc.favorite ? 'starred' : ''}" data-act="fav" title="收藏">${ICONS.star}</button>
        <button class="icon-btn" data-act="del" title="删除">${ICONS.trash}</button>
      </div>`;
    item.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'fav') {
        sc.favorite = !sc.favorite;
        db.updateScenario(sc);
        renderHistory(favoritesOnly);
        return;
      }
      if (act === 'del') {
        if (confirm(`确定删除「${sc.title}」吗？`)) {
          db.deleteScenario(sc.id);
          if (lastScenario?.id === sc.id) lastScenario = null;
          renderHistory(favoritesOnly);
        }
        return;
      }
      renderScenarioDetail(sc, view, { backTab: favoritesOnly ? 'favorites' : 'history' });
    });
    listEl.appendChild(item);
  }
}

// ==================== 生词本 ====================
function renderVocab() {
  const vocab = db.getVocab();
  const dueCount = vocab.filter(isDue).length;
  view.innerHTML = `
    <h1 class="page-title">生词本</h1>
    <p class="page-sub">共 ${vocab.length} 个生词${dueCount ? `，<span style="color:var(--green);font-weight:600">${dueCount} 个待复习</span>` : ''}</p>
    <div class="vocab-toolbar">
      <input type="text" id="vocab-search" placeholder="搜索单词、读音或释义…">
      ${dueCount ? `<button class="btn primary" id="go-review">🎴 开始复习 (${dueCount})</button>` : ''}
    </div>
    <div class="list" id="vocab-list"></div>
  `;
  view.querySelector('#go-review')?.addEventListener('click', () => switchTab('cards'));
  const listEl = view.querySelector('#vocab-list');
  const searchEl = view.querySelector('#vocab-search');

  function draw(filter = '') {
    const f = filter.trim().toLowerCase();
    const shown = vocab.filter(v => !f || [v.word, v.reading, v.meaning].some(s => (s || '').toLowerCase().includes(f)));
    if (shown.length === 0) {
      listEl.innerHTML = `<div class="empty"><div class="big">📖</div><p>${vocab.length === 0 ? '生词本是空的。生成会话后，把生词建议加进来吧' : '没有匹配的生词'}</p></div>`;
      return;
    }
    listEl.innerHTML = shown.map(v => `
      <div class="vocab-row" data-id="${v.id}">
        <div class="w jp">${esc(v.word)}</div>
        <div class="r jp">${esc(v.reading)}</div>
        <div class="m">${esc(v.meaning)}</div>
        <div class="due ${isDue(v) ? 'due-now' : ''}">${formatDue(v.nextReview)}</div>
        <button class="icon-btn" data-act="speak" title="朗读">${ICONS.speaker}</button>
        <button class="icon-btn" data-act="del" title="删除">${ICONS.trash}</button>
      </div>`).join('');
    listEl.querySelectorAll('.vocab-row').forEach(row => {
      const v = vocab.find(x => x.id === row.dataset.id);
      row.querySelector('[data-act=speak]').addEventListener('click', () => speak(v.word));
      row.querySelector('[data-act=del]').addEventListener('click', () => {
        if (confirm(`确定删除「${v.word}」吗？`)) { db.deleteVocab(v.id); renderVocab(); }
      });
    });
  }
  searchEl.addEventListener('input', () => draw(searchEl.value));
  draw();
}

// ==================== 闪卡复习（SM-2） ====================
function renderCards() {
  const due = db.getVocab().filter(isDue);
  if (due.length === 0) {
    const vocab = db.getVocab();
    const next = vocab.map(v => v.nextReview).filter(Boolean).sort((a, b) => a - b)[0];
    view.innerHTML = `
      <h1 class="page-title">闪卡复习</h1>
      <p class="page-sub">基于 SM-2 间隔重复算法安排复习</p>
      <div class="card empty">
        <div class="big">✅</div>
        <p>${vocab.length === 0 ? '生词本是空的，先去练习中收集生词吧' : `今天的复习都完成了！${next ? `下次复习：${formatDue(next)}` : ''}`}</p>
      </div>`;
    return;
  }

  const queue = [...due];
  let idx = 0, reviewed = 0;

  function drawCard() {
    if (idx >= queue.length) {
      view.innerHTML = `
        <h1 class="page-title">闪卡复习</h1>
        <div class="card complete-banner">
          <div class="big">🎉</div>
          <h3>复习完成！</h3>
          <p>本次复习了 ${reviewed} 张卡片，下次复习时间已按记忆曲线自动安排</p>
          <button class="btn primary" style="margin-top:16px" id="back-vocab">查看生词本</button>
        </div>`;
      view.querySelector('#back-vocab').addEventListener('click', () => switchTab('vocab'));
      return;
    }
    const v = queue[idx];
    view.innerHTML = `
      <h1 class="page-title">闪卡复习</h1>
      <div class="flash-wrap">
        <div class="flash-progress">${idx + 1} / ${queue.length}</div>
        <div class="flash-card" id="flash">
          <div class="flash-word jp">${esc(v.word)}</div>
          <div class="flash-hint">点击卡片查看答案</div>
        </div>
        <div id="rate-area"></div>
      </div>`;
    const flash = view.querySelector('#flash');
    let flipped = false;
    flash.addEventListener('click', () => {
      if (flipped) { speak(v.word); return; }
      flipped = true;
      flash.innerHTML = `
        <div class="flash-word jp" style="font-size:28px">${esc(v.word)}</div>
        <div class="flash-reading jp">${esc(v.reading)}</div>
        <div class="flash-meaning">${esc(v.meaning)}</div>
        ${v.example ? `<div class="flash-example jp">${esc(v.example)}${v.exampleChinese ? `<br>${esc(v.exampleChinese)}` : ''}</div>` : ''}
        <div class="flash-hint">再次点击可朗读</div>`;
      speak(v.word);
      view.querySelector('#rate-area').innerHTML = `
        <div class="rate-row">
          <button class="rate-btn q0" data-q="0"><div class="rl">忘记</div><div class="rd">重新学习</div></button>
          <button class="rate-btn q3" data-q="3"><div class="rl">困难</div><div class="rd">勉强想起</div></button>
          <button class="rate-btn q4" data-q="4"><div class="rl">良好</div><div class="rd">稍作犹豫</div></button>
          <button class="rate-btn q5" data-q="5"><div class="rl">简单</div><div class="rd">轻松回忆</div></button>
        </div>`;
      view.querySelectorAll('.rate-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const updated = applySM2(v, +btn.dataset.q);
          db.updateVocab(updated);
          reviewed++;
          idx++;
          drawCard();
        });
      });
    });
  }
  drawCard();
}

// ==================== 设置 ====================
function renderSettings() {
  const s = db.getSettings();
  view.innerHTML = `
    <h1 class="page-title">设置</h1>
    <p class="page-sub">配置 AI 服务与数据管理</p>
    <div class="card settings-section">
      <h3>AI 服务</h3>
      <div class="provider-row">
        <button class="provider-opt ${s.provider === 'claude' ? 'active' : ''}" data-p="claude">
          <div class="pn">Claude (Anthropic)</div>
          <div class="pd">推荐 · 日语表达更自然</div>
        </button>
        <button class="provider-opt ${s.provider === 'openai' ? 'active' : ''}" data-p="openai">
          <div class="pn">OpenAI</div>
          <div class="pd">GPT 系列模型</div>
        </button>
      </div>
      <div class="field">
        <label class="field-label">Claude API Key</label>
        <input type="password" id="claude-key" value="${esc(s.claudeKey)}" placeholder="sk-ant-…" autocomplete="off">
      </div>
      <div class="field">
        <label class="field-label">OpenAI API Key</label>
        <input type="password" id="openai-key" value="${esc(s.openaiKey)}" placeholder="sk-…" autocomplete="off">
      </div>
      <div class="field" style="display:flex;gap:12px">
        <div style="flex:1">
          <label class="field-label">Claude 模型</label>
          <input type="text" id="claude-model" value="${esc(s.claudeModel)}">
        </div>
        <div style="flex:1">
          <label class="field-label">OpenAI 模型</label>
          <input type="text" id="openai-model" value="${esc(s.openaiModel)}">
        </div>
      </div>
      <button class="btn primary" id="save-settings">保存设置</button>
      <p class="hint">密钥保存在浏览器本地（localStorage），保存时会自动去除首尾空格。API 请求直接从浏览器发出，不经过任何服务器。</p>
    </div>
    <div class="card settings-section">
      <h3>语音朗读（TTS）</h3>
      <div class="provider-row">
        <button class="provider-opt tts-opt ${s.ttsProvider !== 'elevenlabs' ? 'active' : ''}" data-t="system">
          <div class="pn">系统语音</div>
          <div class="pd">免费 · 使用浏览器内置日语音色</div>
        </button>
        <button class="provider-opt tts-opt ${s.ttsProvider === 'elevenlabs' ? 'active' : ''}" data-t="elevenlabs">
          <div class="pn">ElevenLabs</div>
          <div class="pd">更自然的 AI 音色 · 需 API Key</div>
        </button>
      </div>
      <div class="field">
        <label class="field-label">ElevenLabs API Key</label>
        <input type="password" id="eleven-key" value="${esc(s.elevenKey)}" placeholder="xi-…" autocomplete="off">
      </div>
      <div class="field" style="display:flex;gap:12px">
        <div style="flex:1">
          <label class="field-label">Voice ID</label>
          <input type="text" id="eleven-voice" value="${esc(s.elevenVoiceId)}">
        </div>
        <div style="flex:1">
          <label class="field-label">模型</label>
          <input type="text" id="eleven-model" value="${esc(s.elevenModel)}">
        </div>
      </div>
      <button class="btn primary" id="save-tts">保存语音设置</button>
      <p class="hint">在 <a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noopener">ElevenLabs 音色库</a>中挑选支持日语的音色并复制其 Voice ID。默认模型 eleven_multilingual_v2 支持日语；同一句话的音频会在本页缓存，避免重复计费。ElevenLabs 请求失败时会自动回退到系统语音。</p>
    </div>
    <div class="card settings-section">
      <h3>数据管理</h3>
      <div class="settings-actions">
        <button class="btn" id="export-btn">📤 导出数据</button>
        <button class="btn" id="import-btn">📥 导入数据</button>
        <button class="btn danger" id="clear-btn">🗑️ 清空所有数据</button>
        <input type="file" id="import-file" accept=".json" style="display:none">
      </div>
      <p class="hint">导出包含全部会话历史与生词本，可用于备份或迁移到其他浏览器。</p>
    </div>
    <div class="note">💡 提示：未配置 API Key 时，「练习」中仍可体验内置演示会话，TTS 朗读、互动模式、生词本和闪卡复习都可正常使用。语音识别需要 Chrome、Edge 或 Safari 浏览器并授权麦克风。</div>
  `;

  let provider = s.provider;
  view.querySelectorAll('.provider-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      provider = btn.dataset.p;
      view.querySelectorAll('.provider-opt').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  view.querySelector('#save-settings').addEventListener('click', () => {
    db.saveSettings(Object.assign(db.getSettings(), {
      provider,
      claudeKey: view.querySelector('#claude-key').value,
      openaiKey: view.querySelector('#openai-key').value,
      claudeModel: view.querySelector('#claude-model').value.trim() || 'claude-sonnet-5',
      openaiModel: view.querySelector('#openai-model').value.trim() || 'gpt-4o',
    }));
    toast('设置已保存');
  });

  let ttsProvider = s.ttsProvider;
  view.querySelectorAll('.tts-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      ttsProvider = btn.dataset.t;
      view.querySelectorAll('.tts-opt').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
  view.querySelector('#save-tts').addEventListener('click', () => {
    const cur = db.getSettings();
    db.saveSettings(Object.assign(cur, {
      ttsProvider,
      elevenKey: view.querySelector('#eleven-key').value,
      elevenVoiceId: view.querySelector('#eleven-voice').value.trim() || '21m00Tcm4TlvDq8ikWAM',
      elevenModel: view.querySelector('#eleven-model').value.trim() || 'eleven_multilingual_v2',
    }));
    if (ttsProvider === 'elevenlabs' && !view.querySelector('#eleven-key').value.trim()) {
      toast('已保存。注意：未填写 ElevenLabs API Key，朗读将继续使用系统语音');
    } else {
      toast('语音设置已保存');
    }
  });

  view.querySelector('#export-btn').addEventListener('click', () => {
    const blob = new Blob([db.exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ai-kotoba-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const fileInput = view.querySelector('#import-file');
  view.querySelector('#import-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      db.importAll(await file.text());
      toast('数据导入成功');
    } catch (e) {
      toast(`导入失败：${e.message}`);
    }
  });
  view.querySelector('#clear-btn').addEventListener('click', () => {
    if (confirm('确定清空所有会话历史和生词本吗？此操作不可恢复（不影响 API Key 设置）。')) {
      db.clearAll();
      lastScenario = null;
      toast('已清空所有数据');
    }
  });
}

// ---------- 启动 ----------
document.addEventListener('tts-fallback', (e) => {
  toast(`ElevenLabs 朗读失败（${e.detail}），已回退到系统语音`);
});
switchTab('practice');
