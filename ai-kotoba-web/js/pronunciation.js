// 日语发音诊断：浏览器录制单声道 WAV，交给 gpt-audio-1.5 做听感分析。
const AUDIO_MODEL = 'gpt-audio-1.5';

export async function startWavRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前浏览器不支持麦克风录音');
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('当前浏览器不支持 Web Audio');

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch {
    throw new Error('无法访问麦克风，请允许麦克风权限后重试');
  }

  const context = new AudioContextClass();
  await context.resume();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silentGain = context.createGain();
  silentGain.gain.value = 0;
  const chunks = [];
  let finished = false;

  processor.onaudioprocess = event => {
    if (!finished) chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(context.destination);

  async function cleanup() {
    processor.onaudioprocess = null;
    try { source.disconnect(); } catch { /* noop */ }
    try { processor.disconnect(); } catch { /* noop */ }
    try { silentGain.disconnect(); } catch { /* noop */ }
    stream.getTracks().forEach(track => track.stop());
    await context.close().catch(() => {});
  }

  async function stop() {
    if (finished) throw new Error('录音已经结束');
    finished = true;
    await cleanup();
    if (!chunks.length) throw new Error('没有录到声音，请重试');
    return encodeWav(chunks, context.sampleRate);
  }

  async function cancel() {
    if (finished) return;
    finished = true;
    await cleanup();
  }

  return { stop, cancel };
}

function encodeWav(chunks, sampleRate) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const sample = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

export async function analyzePronunciation({ audioBlob, target, level, apiKey, nativeLanguage, explanationLanguage }) {
  if (!(audioBlob instanceof Blob) || audioBlob.size < 1000) throw new Error('录音太短，请完整读一遍目标句');
  if (audioBlob.size > 6 * 1024 * 1024) throw new Error('录音过长，请控制在 20 秒以内');
  const audio = await blobToBase64(audioBlob);
  const payload = {
    audio, format: 'wav', target: target.trim(), level, apiKey: (apiKey || '').trim(),
    nativeLanguage: String(nativeLanguage || 'Chinese').trim().slice(0, 80),
    explanationLanguage: String(explanationLanguage || 'Simplified Chinese').trim().slice(0, 80),
  };

  let local = null;
  try {
    local = await fetch('/api/pronunciation/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // 纯静态托管时继续走浏览器 BYOK。
  }
  if (local) {
    const data = await local.json().catch(() => ({}));
    if (local.ok) return normalizeAnalysis(data.analysis || data);
    if (![404, 405, 501].includes(local.status)) {
      throw new Error(data.error || `发音分析失败 (${local.status})`);
    }
  }

  if (!payload.apiKey) {
    throw new Error('发音诊断需要 OpenAI API Key。请在设置中填写，或为 server.py 配置 OPENAI_API_KEY。');
  }
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${payload.apiKey}` },
    body: JSON.stringify(createAudioAnalysisRequest(payload)),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI 音频分析失败 (${response.status})`);
  return normalizeAnalysis(parseJSON(data.choices?.[0]?.message?.content || ''));
}

export function createAudioAnalysisRequest({ audio, target, level, nativeLanguage, explanationLanguage }) {
  return {
    model: AUDIO_MODEL,
    store: false,
    messages: [
      {
        role: 'developer',
        content: 'You are a careful Japanese pronunciation coach. Assess only what is audible. Do not claim laboratory-grade pitch or phoneme measurements. Return valid JSON only.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: analysisPrompt(target, level, nativeLanguage, explanationLanguage) },
          { type: 'input_audio', input_audio: { data: audio, format: 'wav' } },
        ],
      },
    ],
  };
}

function analysisPrompt(target, level, nativeLanguage, explanationLanguage) {
  const feedbackLanguage = explanationLanguage || 'Simplified Chinese';
  return `Analyze a ${nativeLanguage || 'Chinese'}-speaking JLPT ${level} learner reading the Japanese sentence below.\n\nTarget: ${target}\n\nFocus on audible intelligibility, long vowels, geminate consonants, moraic nasal, voicing, mora timing, pauses, and fluency. Pitch-accent comments must be cautious listening impressions, never laboratory measurements. Write every feedback string in ${feedbackLanguage}, while keeping Japanese transcripts and drills in Japanese. Return only:\n{
  "transcript": "Japanese you actually heard",
  "overallScore": 0到100的整数,
  "dimensions": {
    "intelligibility": {"score": 0到100, "feedback": "short feedback in ${feedbackLanguage}"},
    "sounds": {"score": 0到100, "feedback": "short feedback in ${feedbackLanguage}"},
    "rhythm": {"score": 0到100, "feedback": "short feedback in ${feedbackLanguage}"},
    "fluency": {"score": 0到100, "feedback": "short feedback in ${feedbackLanguage}"},
    "prosody": {"score": 0到100, "feedback": "cautious listening impression in ${feedbackLanguage}"}
  },
  "strengths": ["up to 3 specific strengths in ${feedbackLanguage}"],
  "issues": [{"segment": "specific Japanese segment", "type": "issue type in ${feedbackLanguage}", "heard": "what it sounded like", "advice": "advice in ${feedbackLanguage}", "drill": "minimal Japanese drill"}],
  "summary": "2-sentence summary in ${feedbackLanguage}",
  "practicePlan": ["up to 3 next exercises in ${feedbackLanguage}"]
}`;
}

function parseJSON(text) {
  const block = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || String(text);
  const start = block.indexOf('{');
  const end = block.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('音频模型没有返回有效诊断结果');
  return JSON.parse(block.slice(start, end + 1));
}

function normalizeAnalysis(data) {
  const score = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const dimensions = {};
  for (const key of ['intelligibility', 'sounds', 'rhythm', 'fluency', 'prosody']) {
    dimensions[key] = { score: score(data.dimensions?.[key]?.score), feedback: String(data.dimensions?.[key]?.feedback || '') };
  }
  return {
    transcript: String(data.transcript || ''),
    overallScore: score(data.overallScore),
    dimensions,
    strengths: Array.isArray(data.strengths) ? data.strengths.map(String).slice(0, 3) : [],
    issues: Array.isArray(data.issues) ? data.issues.slice(0, 6).map(item => ({
      segment: String(item.segment || ''), type: String(item.type || '发音'), heard: String(item.heard || ''),
      advice: String(item.advice || ''), drill: String(item.drill || ''),
    })) : [],
    summary: String(data.summary || ''),
    practicePlan: Array.isArray(data.practicePlan) ? data.practicePlan.map(String).slice(0, 3) : [],
  };
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
