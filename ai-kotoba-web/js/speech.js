// 日语语音合成（TTS）与语音识别（STT）
// TTS 支持两种引擎：系统语音（speechSynthesis）与 ElevenLabs（需 API Key）
import { getSettings } from './storage.js';

let voicesReady = [];
function loadVoices() {
  voicesReady = speechSynthesis.getVoices();
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

// ---------- 系统 TTS ----------
function speakSystem(text, onEnd) {
  if (!('speechSynthesis' in window)) { onEnd?.(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  u.rate = 0.92;
  const jaVoices = voicesReady.filter(v => v.lang.replace('_', '-').startsWith('ja'));
  // 优先选择增强/优质音色
  const preferred = jaVoices.find(v => /kyoko|o-?ren|premium|enhanced/i.test(v.name)) || jaVoices[0];
  if (preferred) u.voice = preferred;
  if (onEnd) u.onend = onEnd;
  speechSynthesis.speak(u);
}

// ---------- ElevenLabs TTS ----------
let currentAudio = null;
const audioCache = new Map(); // text+voice → objectURL，避免重复计费
const CACHE_MAX = 60;

async function fetchElevenAudio(text, s, voiceId) {
  const voice = voiceId || s.elevenVoiceA;
  const key = `${voice}|${s.elevenModel}|${text}`;
  if (audioCache.has(key)) return audioCache.get(key);
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'xi-api-key': s.elevenKey,
    },
    body: JSON.stringify({
      text,
      model_id: s.elevenModel || 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    let msg = `ElevenLabs API 错误 (${res.status})`;
    try { msg = (await res.json())?.detail?.message || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await res.blob());
  if (audioCache.size >= CACHE_MAX) {
    const oldest = audioCache.keys().next().value;
    URL.revokeObjectURL(audioCache.get(oldest));
    audioCache.delete(oldest);
  }
  audioCache.set(key, url);
  return url;
}

let elevenFailWarned = false;
async function speakEleven(text, onEnd, voiceId) {
  const s = getSettings();
  try {
    const url = await fetchElevenAudio(text, s, voiceId);
    stopSpeaking();
    currentAudio = new Audio(url);
    currentAudio.onended = () => { currentAudio = null; onEnd?.(); };
    await currentAudio.play();
  } catch (e) {
    // 失败时回退到系统语音，只提示一次
    if (!elevenFailWarned) {
      elevenFailWarned = true;
      console.warn('ElevenLabs TTS 失败，回退到系统语音：', e.message);
      document.dispatchEvent(new CustomEvent('tts-fallback', { detail: e.message }));
    }
    speakSystem(text, onEnd);
  }
}

// ---------- 对外接口 ----------
// voiceId：ElevenLabs 音色（用于 A/B 角色区分）；系统语音下忽略
export function speak(text, onEnd, voiceId) {
  const s = getSettings();
  if (s.ttsProvider === 'elevenlabs' && s.elevenKey) {
    speakEleven(text, onEnd, voiceId);
  } else {
    speakSystem(text, onEnd);
  }
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.pause();
    currentAudio = null;
  }
}

// ---------- 语音识别 ----------
export function sttSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// 创建日语语音识别器；返回 { start, stop } 或 null（浏览器不支持）
export function createRecognizer({ onResult, onEnd, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = 'ja-JP';
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    let text = '';
    for (const res of e.results) text += res[0].transcript;
    onResult?.(text, e.results[e.results.length - 1].isFinal);
  };
  rec.onend = () => onEnd?.();
  rec.onerror = (e) => onError?.(e.error);
  return {
    start: () => { try { rec.start(); } catch { /* already started */ } },
    stop: () => rec.stop(),
  };
}
