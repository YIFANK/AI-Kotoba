import * as db from './storage.js';
import { generateScenario, generateArticle, demoScenario, getFeedback, localFeedback, localCLIStatus, freeTalkInstructions, freeTalkReply, freeTalkFeedback, askAssistant } from './services.js';
import { startRealtimeSession } from './realtime.js';
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
// 把「漢字[かんじ]」标记渲染为 <ruby> 注音
function rubyHTML(text) {
  return esc(text).replace(/([㐀-鿿豈-﫿々〆]+)\[([^\[\]]{1,20})\]/g, '<ruby>$1<rt>$2</rt></ruby>');
}
// 日语文本 HTML：有注音数据且开关打开时用 ruby，否则纯文本
function jpHTML(japanese, furigana) {
  return (furigana && db.getSettings().showFurigana) ? rubyHTML(furigana) : esc(japanese);
}
// 角色 A/B 音色（按 orderIndex 奇偶）
function voiceFor(i) {
  const s = db.getSettings();
  return i % 2 === 0 ? s.elevenVoiceA : s.elevenVoiceB;
}
// 学习行为触发签到
function checkIn() {
  if (db.recordActivity()) {
    toast(`✅ 今日已签到，连续学习 ${db.streakInfo().streak} 天！`);
    return true;
  }
  return false;
}
function toggleFurigana() {
  const s = db.getSettings();
  db.saveSettings(Object.assign(s, { showFurigana: !s.showFurigana }));
}
function furiganaBtnHTML() {
  return `<button class="btn small toggle-btn ${db.getSettings().showFurigana ? 'on' : ''}" id="furigana-btn" title="显示/隐藏汉字注音">あ゙ 注音</button>`;
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
const TABS = { practice: renderPractice, freetalk: renderFreeTalk, reading: renderReading, history: () => renderHistory(false), favorites: () => renderHistory(true), vocab: renderVocab, cards: renderCards, settings: renderSettings };

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
let activeRealtime = null; // 进行中的语音实时会话（切换页面时需要关闭麦克风）
function switchTab(tab) {
  currentTab = tab;
  stopSpeaking();
  activeRealtime?.stop();
  activeRealtime = null;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  TABS[tab]();
  view.scrollTop = 0;
  document.querySelector('.main').scrollTop = 0;
}

// ==================== 练习（生成） ====================
const PRESETS = ['在餐厅点餐', '便利店购物', '问路', '酒店入住', '在车站买票', '看医生', '打工面试', '和朋友约饭', '快递取件', '道歉与感谢'];

function streakCardHTML() {
  const st = db.streakInfo();
  return `
    <div class="card streak-card">
      <div>
        <div class="streak-num"><span class="n">${st.streak}</span><span class="u">天连续学习 🔥</span></div>
        <div class="streak-label">累计打卡 ${st.total} 天${st.todayDone ? ' · 今天已完成 ✓' : ''}</div>
      </div>
      ${st.todayDone ? '' : '<button class="btn soft small" id="checkin-btn">今日签到</button>'}
      <div class="streak-week">
        ${st.week.map((w, i) => `
          <div class="week-dot ${w.done ? 'done' : ''} ${i === 6 ? 'today' : ''}">
            <div class="d">${w.done ? '✓' : ''}</div>
            <div class="wd">${i === 6 ? '今天' : w.day}</div>
          </div>`).join('')}
      </div>
    </div>`;
}
function bindCheckinBtn() {
  view.querySelector('#checkin-btn')?.addEventListener('click', () => {
    checkIn();
    switchTab(currentTab);
  });
}

function renderPractice() {
  view.innerHTML = `
    <h1 class="page-title">练习</h1>
    <p class="page-sub">输入一个场景，AI 会先生成地道的日语会话，再补充中文翻译（两轮生成，避免中日夹杂的不自然表达）</p>
    ${streakCardHTML()}
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
  bindCheckinBtn();

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
    checkIn();
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
          ${furiganaBtnHTML()}
          <button class="btn primary" id="interactive-btn">🎭 互动模式</button>
        </div>
      </div>
      <div class="lines" id="lines">
        ${sc.lines.map((l, i) => `
          <div class="line" data-i="${i}" title="点击朗读">
            <span class="badge ${speakerParity(sc, l.speaker, i)}">${esc(l.speaker)}</span>
            <div class="line-body">
              <p class="line-jp jp">${jpHTML(l.japanese, l.furigana)}</p>
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
      if (window.getSelection()?.toString().trim()) return; // 划词中，不触发朗读
      const i = +el.dataset.i;
      const line = sc.lines[i];
      container.querySelectorAll('.line').forEach(x => x.classList.remove('playing'));
      el.classList.add('playing');
      speak(line.japanese, () => el.classList.remove('playing'), voiceFor(i));
    });
  });

  mountAssistant({
    title: sc.title,
    body: sc.lines.map(l => `${l.speaker}：${l.japanese}`).join('\n'),
    level: sc.level,
    contentEl: container.querySelector('#lines'),
    chat: sc.taChat || (sc.taChat = []),
    persist: (h) => { sc.taChat = h; db.updateScenario(sc); },
  });

  container.querySelector('#furigana-btn')?.addEventListener('click', () => {
    toggleFurigana();
    renderScenarioDetail(sc, container, opts);
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
        <div class="line-jp jp" style="font-size:15px">${mine ? esc(line.japanese) : jpHTML(line.japanese, line.furigana)}</div>
        <div class="line-cn">${esc(line.chinese)}</div>
      </div>`;
    row.querySelector('.bubble').addEventListener('click', () => speak(line.japanese, null, voiceFor(i)));
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
      speak(sc.lines[i].japanese, null, voiceFor(i));
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
        <div class="turn-label">🎤 轮到你了！请用日语表达下面的意思（扮演 ${esc(line.speaker)}）：</div>
        <div class="target-line">${esc(line.chinese)}</div>
        <div class="target-cn">💡 想不起来？<span class="hidden-cn jp" id="jp-hint" title="点击显示日语提示">${jpHTML(line.japanese, line.furigana)}</span></div>
        <div class="input-row">
          <button class="mic-btn" id="mic-btn" title="${supported ? '语音输入（日语）' : '当前浏览器不支持语音识别，请使用 Chrome/Edge/Safari'}" ${supported ? '' : 'disabled style="opacity:.4"'}>${ICONS.mic}</button>
          <input type="text" id="user-input" placeholder="${supported ? '点击麦克风说日语，或直接输入…' : '请输入日语…'}" autocomplete="off">
          <button class="btn primary" id="submit-btn">提交</button>
          <button class="btn" id="listen-btn" title="听参考发音（会剧透答案哦）">${ICONS.speaker}</button>
        </div>
      </div>
    `;
    panel.querySelector('#jp-hint').addEventListener('click', e => e.currentTarget.classList.remove('hidden-cn'));
    panel.querySelector('#listen-btn').addEventListener('click', () => speak(line.japanese, null, voiceFor(i)));
    const input = panel.querySelector('#user-input');
    input.focus();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    panel.querySelector('#submit-btn').addEventListener('click', submit);

    const micBtn = panel.querySelector('#mic-btn');
    if (supported) {
      const STT_ERRORS = {
        'not-allowed': '麦克风权限被拒绝。请点击地址栏左侧的图标，允许本站使用麦克风后重试',
        'service-not-allowed': '浏览器语音服务不可用。Safari 用户请在 系统设置 → 键盘 中开启「听写」',
        'audio-capture': '没有找到可用的麦克风，请检查系统声音输入设备',
        'network': '语音识别需要联网（Chrome 使用云端识别服务），请检查网络',
        'language-not-supported': '当前浏览器不支持日语语音识别，建议使用 Chrome 或 Safari',
      };
      const defaultPlaceholder = input.placeholder;
      const stopUI = () => {
        recording = false;
        micBtn.classList.remove('recording');
        input.placeholder = defaultPlaceholder;
      };
      micBtn.addEventListener('click', () => {
        if (recording) { recognizer?.stop(); return; }
        recognizer = createRecognizer({
          onResult: (text) => { input.value = text; },
          onEnd: stopUI,
          onError: (err) => {
            stopUI();
            if (err === 'aborted') return;
            if (err === 'no-speech') { toast('没有听到声音，请靠近麦克风大声一点再试'); return; }
            toast(STT_ERRORS[err] || `语音识别出错：${err}`);
          },
        });
        recognizer.start();
        recording = true;
        micBtn.classList.add('recording');
        input.placeholder = '🎙️ 正在听，请说日语…（再点一次麦克风结束）';
        input.focus();
      });
    }

    async function submit() {
      const text = input.value.trim();
      if (!text) { toast('请先说出或输入台词'); return; }
      recognizer?.stop();
      panel.innerHTML = '';
      appendBubble(Object.assign({}, line, { japanese: text, chinese: '（你的回答）' }), i, true);
      session.userLines++;
      checkIn();

      const fbRow = appendFeedback('正在点评…');
      let fb;
      try {
        fb = db.hasAPIKey() ? await getFeedback(line.japanese, line.chinese, text) : localFeedback(line.japanese, text);
      } catch {
        fb = localFeedback(line.japanese, text);
      }
      fbRow.querySelector('.bubble').innerHTML = `<div class="feedback-label">💬 AI 反馈</div>${esc(fb)}`;

      panel.innerHTML = `
        <div style="text-align:center;margin-top:16px" class="line-cn">参考台词：<span class="jp" style="color:var(--text)">${jpHTML(line.japanese, line.furigana)}</span></div>
        <div style="display:flex;gap:10px;margin-top:12px;justify-content:center">
          <button class="btn" id="ref-btn">${ICONS.speaker} 听参考发音</button>
          <button class="btn primary" id="next-btn">下一句 →</button>
        </div>`;
      panel.querySelector('#ref-btn').addEventListener('click', () => speak(line.japanese, null, voiceFor(i)));
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

// ==================== 自由对话 ====================
const FREETALK_PRESETS = ['在居酒屋和老板闲聊', '和日本同事聊周末计划', '在美容院剪头发', '和房东讨论租房问题', '跟新朋友互相自我介绍', '在旅游咨询处询问景点'];

function renderFreeTalk() {
  stopSpeaking();
  const s = db.getSettings();
  view.innerHTML = `
    <h1 class="page-title">自由对话</h1>
    <p class="page-sub">脱稿练习：设定一个场景，和 AI 自由地用日语聊天，结束后获取学习点评</p>
    <div class="card">
      <label class="field-label">场景 / 角色设定</label>
      <div class="gen-row">
        <input type="text" id="ft-scene" placeholder="例如：在居酒屋和老板闲聊" maxlength="60">
        <select id="ft-level">
          ${['N5', 'N4', 'N3', 'N2', 'N1'].map(l => `<option ${l === 'N4' ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="chips">
        ${FREETALK_PRESETS.map(p => `<button class="chip" data-topic="${esc(p)}">${esc(p)}</button>`).join('')}
      </div>
      <label class="field-label" style="margin-top:6px">对话方式</label>
      <div class="mode-cards">
        <button class="role-card" id="ft-voice">
          <div class="emoji">🎙️</div>
          <div class="name">语音实时对话</div>
          <div class="desc">像打电话一样自然交谈（OpenAI Realtime${s.openaiKey ? '' : ' · 需先配置 OpenAI Key'}）</div>
        </button>
        <button class="role-card" id="ft-text">
          <div class="emoji">💬</div>
          <div class="name">文字对话</div>
          <div class="desc">打字或语音输入，AI 日语回复并朗读（用当前 AI 服务）</div>
        </button>
      </div>
    </div>
  `;
  const sceneInput = view.querySelector('#ft-scene');
  view.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { sceneInput.value = c.dataset.topic; }));
  const getSetup = () => {
    const scene = sceneInput.value.trim();
    if (!scene) { toast('先设定一个场景吧'); sceneInput.focus(); return null; }
    return { scene, level: view.querySelector('#ft-level').value };
  };
  view.querySelector('#ft-voice').addEventListener('click', () => {
    const setup = getSetup();
    if (!setup) return;
    if (!db.getSettings().openaiKey) { toast('语音实时对话需要 OpenAI API Key，请先到「设置」中填写'); return; }
    startFreeTalkVoice(setup.scene, setup.level);
  });
  view.querySelector('#ft-text').addEventListener('click', () => {
    const setup = getSetup();
    if (!setup) return;
    if (!db.hasAPIKey()) { toast('请先在「设置」中配置 AI 服务（本地 CLI 或 API Key）'); return; }
    startFreeTalkText(setup.scene, setup.level);
  });
}

function freeTalkShell(scene, level, statusHTML) {
  view.innerHTML = `
    <div class="back-row"><button class="btn small" id="ft-exit">${ICONS.back} 结束对话</button></div>
    <h1 class="page-title" style="font-size:19px">自由对话 · ${esc(scene)} <span class="tag level">JLPT ${esc(level)}</span></h1>
    <div class="freetalk-bar">${statusHTML}<div class="spacer"></div><button class="btn small" id="ft-feedback" style="display:none">📝 获取学习点评</button></div>
    <div class="chat" id="ft-chat"></div>
    <div id="ft-panel"></div>
  `;
  return {
    chat: view.querySelector('#ft-chat'),
    panel: view.querySelector('#ft-panel'),
    exitBtn: view.querySelector('#ft-exit'),
    feedbackBtn: view.querySelector('#ft-feedback'),
  };
}

function ftBubble(chat, role, text) {
  const row = document.createElement('div');
  row.className = `bubble-row ${role === 'me' ? 'me' : ''}`;
  row.innerHTML = `
    <span class="avatar ${role === 'me' ? 'a' : 'b'}">${role === 'me' ? '我' : 'AI'}</span>
    <div class="bubble"><div class="line-jp jp" style="font-size:15px">${esc(text)}</div></div>`;
  chat.appendChild(row);
  row.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return row;
}

async function showFreeTalkFeedback(scene, history, container) {
  if (history.filter(h => h.role === 'me').length === 0) { toast('先聊几句再获取点评吧'); return; }
  const transcript = history.map(h => `${h.role === 'me' ? '我' : '对方'}：${h.text}`).join('\n');
  const box = document.createElement('div');
  box.className = 'bubble feedback';
  box.style.maxWidth = '100%';
  box.innerHTML = `<div class="feedback-label">📝 学习点评</div>正在生成点评…`;
  container.appendChild(box);
  box.scrollIntoView({ behavior: 'smooth', block: 'end' });
  try {
    const fb = await freeTalkFeedback(scene, transcript);
    // 轻量渲染：仅支持加粗，其余按纯文本
    const html = esc(fb).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    box.innerHTML = `<div class="feedback-label">📝 学习点评</div><div style="white-space:pre-wrap">${html}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="feedback-label">📝 学习点评</div>生成失败：${esc(e.message)}`;
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// ---------- 文字模式 ----------
function startFreeTalkText(scene, level) {
  const history = [];
  const ui = freeTalkShell(scene, level, '<span class="rt-status"><span class="rt-dot"></span>文字模式</span>');
  ui.exitBtn.addEventListener('click', () => { stopSpeaking(); renderFreeTalk(); });
  ui.feedbackBtn.addEventListener('click', () => showFreeTalkFeedback(scene, history, ui.chat));

  const supported = sttSupported();
  ui.panel.innerHTML = `
    <div class="user-panel" style="margin-top:16px">
      <div class="input-row" style="margin-top:0">
        <button class="mic-btn" id="ft-mic" ${supported ? '' : 'disabled style="opacity:.4"'} title="${supported ? '语音输入（日语）' : '当前浏览器不支持语音识别'}">${ICONS.mic}</button>
        <input type="text" id="ft-input" placeholder="用日语说点什么吧…（对方会先等你开口）" autocomplete="off">
        <button class="btn primary" id="ft-send">发送</button>
      </div>
    </div>`;
  const input = ui.panel.querySelector('#ft-input');
  const sendBtn = ui.panel.querySelector('#ft-send');
  input.focus();

  let recognizer = null, recording = false;
  const micBtn = ui.panel.querySelector('#ft-mic');
  if (supported) {
    micBtn.addEventListener('click', () => {
      if (recording) { recognizer?.stop(); return; }
      recognizer = createRecognizer({
        onResult: (text) => { input.value = text; },
        onEnd: () => { recording = false; micBtn.classList.remove('recording'); },
        onError: (err) => {
          recording = false; micBtn.classList.remove('recording');
          if (err !== 'aborted' && err !== 'no-speech') toast(`语音识别出错：${err}`);
        },
      });
      recognizer.start();
      recording = true;
      micBtn.classList.add('recording');
    });
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    recognizer?.stop();
    input.value = '';
    ftBubble(ui.chat, 'me', text);
    checkIn();
    const pending = ftBubble(ui.chat, 'ai', '…');
    pending.querySelector('.bubble').classList.add('thinking');
    sendBtn.disabled = true;
    try {
      const reply = await freeTalkReply(scene, level, history, text);
      history.push({ role: 'me', text }, { role: 'ai', text: reply });
      pending.querySelector('.bubble').classList.remove('thinking');
      pending.querySelector('.line-jp').textContent = reply;
      speak(reply, null, db.getSettings().elevenVoiceB);
      if (history.filter(h => h.role === 'me').length >= 2) ui.feedbackBtn.style.display = '';
    } catch (e) {
      pending.querySelector('.line-jp').textContent = `（回复失败：${e.message}）`;
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
}

// ---------- 语音实时模式（OpenAI Realtime） ----------
async function startFreeTalkVoice(scene, level) {
  const history = [];
  const ui = freeTalkShell(scene, level, '<span class="rt-status connecting" id="rt-status"><span class="rt-dot"></span><span id="rt-status-text">正在连接…</span></span>');
  const statusEl = view.querySelector('#rt-status');
  const statusText = view.querySelector('#rt-status-text');
  const STATUS = { idle: ['', '你可以说话了'], listening: ['listening', '正在听你说…'], speaking: ['speaking', 'AI 正在说话'], connecting: ['connecting', '正在连接…'] };
  const setStatus = (key) => {
    const [cls, text] = STATUS[key] || STATUS.idle;
    statusEl.className = `rt-status ${cls}`;
    statusText.textContent = text;
  };

  let aiRow = null, aiText = '';
  let session = null;
  const cleanup = () => { session?.stop(); session = null; activeRealtime = null; };

  ui.exitBtn.addEventListener('click', () => { cleanup(); renderFreeTalk(); });
  ui.feedbackBtn.addEventListener('click', () => showFreeTalkFeedback(scene, history, ui.chat));
  ui.panel.innerHTML = `<p class="hint" style="text-align:center;margin-top:14px">💡 直接开口说日语即可，AI 会用语音回应，可以随时打断。说「中文」可请求提示。</p>`;

  try {
    session = await startRealtimeSession({
      apiKey: db.getSettings().openaiKey,
      instructions: freeTalkInstructions(scene, level),
      onStatus: setStatus,
      onUserText: (text) => {
        ftBubble(ui.chat, 'me', text);
        history.push({ role: 'me', text });
        checkIn();
        if (history.filter(h => h.role === 'me').length >= 2) ui.feedbackBtn.style.display = '';
      },
      onAIDelta: (delta) => {
        if (!aiRow) { aiRow = ftBubble(ui.chat, 'ai', ''); aiText = ''; }
        aiText += delta;
        aiRow.querySelector('.line-jp').textContent = aiText;
      },
      onAIDone: (full) => {
        const text = full || aiText;
        if (aiRow && text) aiRow.querySelector('.line-jp').textContent = text;
        if (text) history.push({ role: 'ai', text });
        aiRow = null; aiText = '';
      },
      onError: (msg) => toast(`实时对话：${msg}`),
    });
    activeRealtime = session;
    setStatus('idle');
  } catch (e) {
    cleanup();
    ui.panel.innerHTML = `<div class="gen-status" style="color:#d3455b;justify-content:center">${esc(e.message)}</div>
      <div style="text-align:center;margin-top:14px"><button class="btn" id="rt-back">返回</button></div>`;
    view.querySelector('#rt-back').addEventListener('click', renderFreeTalk);
    statusEl.className = 'rt-status';
    statusText.textContent = '连接失败';
  }
}

// ==================== 阅读 ====================
const READING_PRESETS = ['介绍我最喜欢的漫画家', '日本的四季与节日', '一个关于猫的暖心小故事', '如何做正宗的日式咖喱', '东京一日游攻略', '日本高中生的一天'];

function renderReading() {
  const articles = db.getArticles();
  view.innerHTML = `
    <h1 class="page-title">阅读</h1>
    <p class="page-sub">告诉 AI 你想读什么，它会写一篇符合你水平的日语短文（含注音、翻译和生词）</p>
    <div class="card">
      <label class="field-label">想读什么？</label>
      <div class="gen-row">
        <input type="text" id="article-input" placeholder="例如：介绍我最喜欢的漫画家" maxlength="80">
        <select id="article-level">
          ${['N5', 'N4', 'N3', 'N2', 'N1'].map(l => `<option ${l === 'N4' ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <button class="btn primary" id="article-btn">📖 生成文章</button>
      </div>
      <div class="chips">
        ${READING_PRESETS.map(p => `<button class="chip" data-topic="${esc(p)}">${esc(p)}</button>`).join('')}
      </div>
      <div id="article-status"></div>
    </div>
    <div class="section-title" style="margin-top:26px">📚 我的文章（${articles.length}）</div>
    <div class="list" id="article-list">
      ${articles.length === 0 ? '<div class="empty"><div class="big">📖</div><p>还没有文章，生成第一篇吧</p></div>' : ''}
    </div>
  `;
  const input = view.querySelector('#article-input');
  view.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { input.value = c.dataset.topic; }));
  view.querySelector('#article-btn').addEventListener('click', onGenerateArticle);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') onGenerateArticle(); });

  const listEl = view.querySelector('#article-list');
  for (const a of articles) {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <span class="badge b" style="min-width:38px;height:38px;border-radius:11px;font-size:15px">${esc((a.title || '文')[0])}</span>
      <div class="list-item-body">
        <div class="list-item-title jp">${esc(a.title)}</div>
        <div class="list-item-sub">${a.titleChinese ? esc(a.titleChinese) + ' · ' : ''}JLPT ${esc(a.level)} · ${a.paragraphs.length} 段 · ${fmtDate(a.createdAt)}</div>
      </div>
      <div class="list-item-actions">
        <button class="icon-btn" data-act="del" title="删除">${ICONS.trash}</button>
      </div>`;
    item.addEventListener('click', (e) => {
      if (e.target.closest('[data-act=del]')) {
        if (confirm(`确定删除「${a.title}」吗？`)) { db.deleteArticle(a.id); renderReading(); }
        return;
      }
      renderArticleDetail(a);
    });
    listEl.appendChild(item);
  }
}

async function onGenerateArticle() {
  const input = view.querySelector('#article-input');
  const request = input.value.trim();
  const level = view.querySelector('#article-level').value;
  const status = view.querySelector('#article-status');
  const btn = view.querySelector('#article-btn');
  if (!request) { toast('先告诉 AI 你想读什么吧'); input.focus(); return; }
  if (!db.hasAPIKey()) { toast('请先在「设置」中配置 AI 服务（本地 CLI 或 API Key）'); return; }

  btn.disabled = true;
  try {
    const article = await generateArticle(`JLPT ${level} 水平：${request}`, level, msg => {
      status.innerHTML = `<div class="gen-status"><div class="spinner"></div>${esc(msg)}</div>`;
    });
    db.saveArticle(article);
    checkIn();
    status.innerHTML = '';
    renderArticleDetail(article);
  } catch (e) {
    status.innerHTML = `<div class="gen-status" style="color:#d3455b">生成失败：${esc(e.message)}</div>`;
    btn.disabled = false;
  }
}

function renderArticleDetail(a) {
  stopSpeaking();
  const vocabWords = new Set(db.getVocab().map(v => v.word));
  const showCn = a._showCn ?? false;
  view.innerHTML = `
    <div class="back-row"><button class="btn small" id="back-btn">${ICONS.back} 返回阅读</button></div>
    <div class="card">
      <div class="scenario-head">
        <div>
          <div class="scenario-title jp">${esc(a.title)}</div>
          ${a.titleChinese ? `<div class="scenario-title-cn">${esc(a.titleChinese)}</div>` : ''}
          <div class="scenario-meta">
            <span class="tag level">JLPT ${esc(a.level)}</span>
            <span class="tag">${fmtDate(a.createdAt)}</span>
          </div>
        </div>
        <div class="scenario-actions detail-toolbar">
          ${furiganaBtnHTML()}
          <button class="btn small toggle-btn ${showCn ? 'on' : ''}" id="cn-btn">中 译文</button>
        </div>
      </div>
      <div id="paras">
        ${a.paragraphs.map((p, i) => `
          <div class="article-para" data-i="${i}" title="点击朗读本段">
            <div class="jp-text jp">${jpHTML(p.japanese, p.furigana)}</div>
            ${showCn && p.chinese ? `<div class="cn-text">${esc(p.chinese)}</div>` : ''}
          </div>`).join('')}
      </div>
      <div class="section-title">📖 生词建议</div>
      <div class="vocab-grid">
        ${a.vocabulary.map((v, i) => `
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
  view.querySelector('#back-btn').addEventListener('click', () => { stopSpeaking(); switchTab('reading'); });
  view.querySelector('#furigana-btn').addEventListener('click', () => { toggleFurigana(); renderArticleDetail(a); });
  view.querySelector('#cn-btn').addEventListener('click', () => { a._showCn = !showCn; renderArticleDetail(a); });
  view.querySelectorAll('.article-para').forEach(el => {
    el.addEventListener('click', () => {
      if (window.getSelection()?.toString().trim()) return; // 划词中，不触发朗读
      const p = a.paragraphs[+el.dataset.i];
      view.querySelectorAll('.article-para').forEach(x => x.classList.remove('playing'));
      el.classList.add('playing');
      speak(p.japanese, () => el.classList.remove('playing'), db.getSettings().elevenVoiceA);
    });
  });
  view.querySelectorAll('.add-vocab').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = a.vocabulary[+btn.dataset.i];
      if (db.addVocab(v)) { btn.disabled = true; btn.textContent = '已在生词本'; toast(`「${v.word}」已加入生词本`); }
    });
  });

  mountAssistant({
    title: a.title,
    body: a.paragraphs.map(p => p.japanese).join('\n\n'),
    level: a.level,
    contentEl: view.querySelector('#paras'),
    chat: a.taChat || (a.taChat = []),
    persist: (h) => { a.taChat = h; db.updateArticle(a); },
  });
}

// ==================== AI 助教（课文旁答疑） ====================
// ctx: { title, body, level, contentEl, chat, persist }
function mountAssistant(ctx) {
  view.querySelectorAll('.ta-panel, .ta-fab, .ta-ask-float').forEach(e => e.remove());
  const hist = ctx.chat || [];
  let currentQuote = '';

  const fab = document.createElement('button');
  fab.className = 'ta-fab';
  fab.textContent = '🎓';
  fab.title = 'AI 助教：划选课文提问，或直接问';

  const panel = document.createElement('div');
  panel.className = 'ta-panel';
  panel.innerHTML = `
    <div class="ta-head">
      <span class="ta-title">🎓 AI 助教</span>
      <span class="ta-sub">关于这篇课文，随便问</span>
      <button class="icon-btn" id="ta-close" title="收起">✕</button>
    </div>
    <div class="ta-chat" id="ta-chat"></div>
    <div class="ta-foot">
      <div class="ta-quote" id="ta-quote" style="display:none">
        <span class="txt jp" id="ta-quote-text"></span>
        <button class="x" id="ta-quote-clear" title="取消引用">✕</button>
      </div>
      <div class="ta-chips" id="ta-chips" style="display:none">
        <button class="chip" data-q="解释这句的语法结构">解释语法</button>
        <button class="chip" data-q="这句话还有没有别的说法？给 1-2 种">换个说法</button>
        <button class="chip" data-q="用这里的关键词再造一个例句">造个例句</button>
        <button class="chip" data-q="翻译这句并逐词拆解">翻译拆解</button>
      </div>
      <div class="input-row" style="margin-top:6px">
        <input type="text" id="ta-input" placeholder="问点什么…（可先在课文中划选句子）" autocomplete="off">
        <button class="btn primary small" id="ta-send">发送</button>
      </div>
    </div>`;

  const askBtn = document.createElement('button');
  askBtn.className = 'btn small primary ta-ask-float';
  askBtn.textContent = '🎓 问助教';
  askBtn.style.display = 'none';

  view.append(fab, panel, askBtn);
  const chatEl = panel.querySelector('#ta-chat');
  const input = panel.querySelector('#ta-input');
  const quoteBox = panel.querySelector('#ta-quote');
  const chipsBox = panel.querySelector('#ta-chips');

  function msg(cls, html) {
    const d = document.createElement('div');
    d.className = 'ta-msg ' + cls;
    d.innerHTML = html;
    chatEl.appendChild(d);
    chatEl.scrollTop = chatEl.scrollHeight;
    return d;
  }
  function renderEmpty() {
    if (hist.length === 0 && chatEl.children.length === 0) {
      chatEl.innerHTML = `<div class="ta-empty">在课文里<b>划选一句话</b>，点「问助教」<br>或直接在下面输入问题</div>`;
    }
  }
  function clearEmpty() {
    chatEl.querySelector('.ta-empty')?.remove();
  }
  function setQuote(text) {
    currentQuote = text;
    panel.querySelector('#ta-quote-text').textContent = text;
    quoteBox.style.display = text ? '' : 'none';
    chipsBox.style.display = text ? '' : 'none';
  }
  panel.querySelector('#ta-quote-clear').addEventListener('click', () => setQuote(''));
  function openPanel() { panel.classList.add('open'); input.focus(); }
  fab.addEventListener('click', () => panel.classList.toggle('open'));
  panel.querySelector('#ta-close').addEventListener('click', () => panel.classList.remove('open'));

  // 历史问答回填
  for (const h of hist) {
    msg('q', (h.quote ? `<div class="ta-q-quote jp">「${esc(h.quote)}」</div>` : '') + esc(h.q));
    msg('a', esc(h.a).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>'));
  }
  renderEmpty();

  async function send(question) {
    question = (question || '').trim();
    if (!question) return;
    if (!db.hasAPIKey()) { toast('请先在「设置」中配置 AI 服务（本地 CLI 或 API Key）'); return; }
    const quote = currentQuote;
    clearEmpty();
    setQuote('');
    input.value = '';
    msg('q', (quote ? `<div class="ta-q-quote jp">「${esc(quote)}」</div>` : '') + esc(question));
    const pending = msg('a thinking', '助教思考中…');
    try {
      const ans = await askAssistant({ title: ctx.title, body: ctx.body, level: ctx.level, quote, question, history: hist.slice(-3) });
      pending.classList.remove('thinking');
      pending.innerHTML = esc(ans).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
      hist.push({ q: question, quote, a: ans });
      ctx.persist?.(hist);
      checkIn();
    } catch (e) {
      pending.textContent = `回答失败：${e.message}`;
    }
    chatEl.scrollTop = chatEl.scrollHeight;
  }
  panel.querySelector('#ta-send').addEventListener('click', () => send(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(input.value); });
  chipsBox.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => send(c.dataset.q)));

  // 划词 → 浮出「问助教」
  let selectedText = '';
  ctx.contentEl?.addEventListener('mouseup', () => setTimeout(() => {
    const sel = window.getSelection();
    if (!sel?.rangeCount) { askBtn.style.display = 'none'; return; }
    // 克隆选区并剔除注音（rt），得到干净的原文
    const frag = sel.getRangeAt(0).cloneContents();
    frag.querySelectorAll('rt').forEach(e => e.remove());
    const text = (frag.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 2 || text.length > 300) { askBtn.style.display = 'none'; return; }
    selectedText = text;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    askBtn.style.display = '';
    askBtn.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 48)}px`;
    askBtn.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - 50, window.innerWidth - 130))}px`;
  }, 10));
  ctx.contentEl?.addEventListener('mousedown', () => { askBtn.style.display = 'none'; });
  askBtn.addEventListener('mousedown', e => e.preventDefault()); // 保住选区
  askBtn.addEventListener('click', () => {
    askBtn.style.display = 'none';
    setQuote(selectedText);
    openPanel();
  });
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
          checkIn();
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
      <div class="provider-row" style="grid-template-columns:repeat(3,1fr)">
        <button class="provider-opt ai-provider-opt ${s.provider === 'local' ? 'active' : ''}" data-p="local">
          <div class="pn">本地 CLI <span class="tag" style="background:var(--green-soft);color:var(--green);font-weight:600">免 Key</span></div>
          <div class="pd">调用本机已登录的 Claude Code / Codex</div>
        </button>
        <button class="provider-opt ai-provider-opt ${s.provider === 'claude' ? 'active' : ''}" data-p="claude">
          <div class="pn">Claude API</div>
          <div class="pd">日语表达更自然 · 需 API Key</div>
        </button>
        <button class="provider-opt ai-provider-opt ${s.provider === 'openai' ? 'active' : ''}" data-p="openai">
          <div class="pn">OpenAI API</div>
          <div class="pd">GPT 系列 · 需 API Key</div>
        </button>
      </div>
      <div class="field">
        <label class="field-label">本地引擎</label>
        <select id="local-engine">
          <option value="claude" ${s.localEngine !== 'codex' ? 'selected' : ''}>Claude Code（claude -p）</option>
          <option value="codex" ${s.localEngine === 'codex' ? 'selected' : ''}>Codex（codex exec）</option>
        </select>
        <p class="hint" id="local-status">正在检测本地 CLI…</p>
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
      <p class="hint">「本地 CLI」通过本站自带的 server.py 调用你电脑上已登录的命令行工具，用订阅额度、无需 API Key，但要求用 python3 server.py 启动本站。API 方式的密钥保存在浏览器本地（localStorage），请求直接从浏览器发出，不经过任何服务器。</p>
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
          <label class="field-label">角色 A 音色（默认 Sarah · 女声）</label>
          <input type="text" id="eleven-voice-a" value="${esc(s.elevenVoiceA)}">
        </div>
        <div style="flex:1">
          <label class="field-label">角色 B 音色（默认 George · 男声）</label>
          <input type="text" id="eleven-voice-b" value="${esc(s.elevenVoiceB)}">
        </div>
      </div>
      <div class="field">
        <label class="field-label">模型</label>
        <input type="text" id="eleven-model" value="${esc(s.elevenModel)}">
      </div>
      <button class="btn primary" id="save-tts">保存语音设置</button>
      <p class="hint">对话中角色 A / B 会分别使用两个音色（按台词奇偶自动分配），文章朗读与闪卡使用音色 A。想换声线可在 <a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noopener">ElevenLabs 音色库</a>中挑选（搜 Japanese 可找到日语母语者音色）并粘贴其 Voice ID。默认模型 eleven_multilingual_v2 支持日语；同一句话的音频会在本页缓存，避免重复计费；请求失败自动回退系统语音。</p>
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
  view.querySelectorAll('.ai-provider-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      provider = btn.dataset.p;
      view.querySelectorAll('.ai-provider-opt').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  view.querySelector('#save-settings').addEventListener('click', () => {
    db.saveSettings(Object.assign(db.getSettings(), {
      provider,
      localEngine: view.querySelector('#local-engine').value,
      claudeKey: view.querySelector('#claude-key').value,
      openaiKey: view.querySelector('#openai-key').value,
      claudeModel: view.querySelector('#claude-model').value.trim() || 'claude-sonnet-5',
      openaiModel: view.querySelector('#openai-model').value.trim() || 'gpt-4o',
    }));
    toast('设置已保存');
  });

  // 检测本地 CLI 桥接可用性
  localCLIStatus().then(st => {
    const el = view.querySelector('#local-status');
    if (!el) return;
    if (!st) {
      el.innerHTML = '⚠️ 未检测到本地桥接服务。请用 <code>python3 server.py</code> 启动本站后再使用「本地 CLI」。';
      return;
    }
    const mark = ok => ok ? '<span style="color:var(--green)">✓ 已安装</span>' : '<span style="color:#d3455b">✗ 未找到</span>';
    el.innerHTML = `本地检测：Claude Code ${mark(st.claude)}　·　Codex ${mark(st.codex)}`;
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
      elevenVoiceA: view.querySelector('#eleven-voice-a').value.trim() || 'EXAVITQu4vr4xnSDxMaL',
      elevenVoiceB: view.querySelector('#eleven-voice-b').value.trim() || 'JBFqnCBsd6RMkjVDRZzb',
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
// 先与服务器同步数据（跨浏览器共享），失败则纯本地模式
db.initSync().finally(() => switchTab('practice'));
