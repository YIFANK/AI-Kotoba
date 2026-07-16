// OpenAI Realtime API（WebRTC）语音 Tutor
// 优先通过本地 server.py 的统一接口建立会话；纯静态托管时保留 BYOK 直连兼容。
const REALTIME_MODEL = 'gpt-realtime-2.1';
const REALTIME_MAX_DURATION_MS = 12 * 60 * 1000;
const ALLOWED_VOICES = new Set(['marin', 'cedar']);
const REALTIME_TRUNCATION = {
  type: 'retention_ratio',
  retention_ratio: 0.8,
};
const TUTOR_TOOLS = [
  {
    type: 'function',
    name: 'save_vocabulary',
    description: 'Save a useful Japanese word or expression to the learner’s vocabulary and spaced-repetition queue. Use when the learner explicitly asks to save or remember an expression.',
    parameters: {
      type: 'object',
      properties: {
        word: { type: 'string', description: 'Japanese word or expression to save.' },
        reading: { type: 'string', description: 'Kana reading.' },
        meaning: { type: 'string', description: 'Short meaning in the learner’s configured explanation language.' },
        example: { type: 'string', description: 'Natural Japanese example sentence.' },
        exampleTranslation: { type: 'string', description: 'Translation in the learner’s configured explanation language.' },
      },
      required: ['word', 'meaning'],
    },
  },
  {
    type: 'function',
    name: 'remember_learning_point',
    description: 'Store a correction or recurring weakness in the learner’s long-term profile. Use when the learner asks you to remember a mistake or when they explicitly mark it as an ongoing weakness.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'One short issue category in the learner’s configured explanation language.' },
        original: { type: 'string', description: 'The learner’s original Japanese.' },
        better: { type: 'string', description: 'A corrected or more natural Japanese expression.' },
        note: { type: 'string', description: 'One short explanation in the learner’s configured explanation language.' },
      },
      required: ['category', 'better', 'note'],
    },
  },
];
const SESSION_REVIEW_TOOL = {
  type: 'function',
  name: 'submit_session_review',
  description: 'Submit the final structured Japanese-learning review for this voice session. Base it on the original audio, the learner’s responses, and the complete conversation context rather than trusting automatic transcription word-for-word.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string', description: 'A concise overall review in the learner’s configured explanation language.' },
      strengths: {
        type: 'array',
        maxItems: 3,
        items: { type: 'string' },
        description: 'Up to three concrete strengths supported by the session.',
      },
      improvements: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            original: { type: 'string', description: 'The learner wording only when confidently heard; otherwise an empty string.' },
            better: { type: 'string', description: 'A more natural Japanese expression.' },
            explanation: { type: 'string', description: 'A short explanation in the configured explanation language.' },
          },
          required: ['original', 'better', 'explanation'],
        },
      },
      usefulPhrases: {
        type: 'array',
        minItems: 3,
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            japanese: { type: 'string', description: 'A useful Japanese word or expression from, or directly useful for, this conversation.' },
            reading: { type: 'string', description: 'Kana reading.' },
            meaning: { type: 'string', description: 'Meaning in the configured explanation language.' },
            example: { type: 'string', description: 'A natural Japanese example sentence.' },
            exampleTranslation: { type: 'string', description: 'Example translation in the configured explanation language.' },
          },
          required: ['japanese', 'reading', 'meaning', 'example', 'exampleTranslation'],
        },
      },
      grammarEvidence: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            pattern: { type: 'string' },
            level: { type: 'string', enum: ['N5', 'N4', 'N3', 'unknown'] },
            result: { type: 'string', enum: ['used-well', 'needs-work'] },
            note: { type: 'string' },
          },
          required: ['pattern', 'level', 'result', 'note'],
        },
      },
      nextStep: { type: 'string', description: 'One specific next practice task in the configured explanation language.' },
    },
    required: ['summary', 'strengths', 'improvements', 'usefulPhrases', 'grammarEvidence', 'nextStep'],
  },
};

export async function startRealtimeSession({
  apiKey,
  instructions,
  voice = 'marin',
  inputLanguage = 'ja',
  onUserText,
  onAIDelta,
  onAIDone,
  onStatus,
  onError,
  onToolCall,
  onTimeRemaining,
  onTimeLimit,
  reviewLanguage = 'Simplified Chinese',
  maxDurationMs = REALTIME_MAX_DURATION_MS,
}) {
  const selectedVoice = ALLOWED_VOICES.has(voice) ? voice : 'marin';
  const transcription = { model: 'gpt-realtime-whisper', delay: 'low' };
  if (inputLanguage && inputLanguage !== 'auto') transcription.language = inputLanguage;
  const pc = new RTCPeerConnection();
  const audioEl = document.createElement('audio');
  audioEl.autoplay = true;
  audioEl.setAttribute('playsinline', '');
  pc.ontrack = (event) => { audioEl.srcObject = event.streams[0]; };

  let stream;
  let stopped = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    pc.close();
    throw new Error('无法访问麦克风，请在浏览器中允许麦克风权限');
  }
  const audioTrack = stream.getAudioTracks()[0];
  audioTrack.enabled = false;
  pc.addTrack(audioTrack, stream);

  const sessionConfig = {
    type: 'realtime',
    model: REALTIME_MODEL,
    output_modalities: ['audio'],
    instructions,
    audio: {
      input: {
        transcription,
        turn_detection: null,
      },
      output: { voice: selectedVoice },
    },
    truncation: REALTIME_TRUNCATION,
    tools: TUTOR_TOOLS,
    tool_choice: 'auto',
  };

  let lessonStarted = false;
  let responseActive = false;
  let talking = false;
  let talkCycle = 0;
  let talkStartedAt = 0;
  let commitTimer = null;
  let durationTimer = null;
  let durationDeadline = 0;
  let reviewRequest = null;
  const dc = pc.createDataChannel('oai-events');
  dc.addEventListener('open', () => {
    dc.send(JSON.stringify({ type: 'session.update', session: sessionConfig }));
    onStatus?.('idle');
  });
  dc.addEventListener('message', (event) => {
    let ev;
    try { ev = JSON.parse(event.data); } catch { return; }
    switch (ev.type) {
      case 'session.updated':
        if (!lessonStarted) {
          lessonStarted = true;
          dc.send(JSON.stringify({
            type: 'response.create',
            response: {},
          }));
        }
        break;
      case 'input_audio_buffer.speech_started':
        onStatus?.('listening');
        break;
      case 'input_audio_buffer.speech_stopped':
        onStatus?.('thinking');
        break;
      case 'response.created':
        responseActive = true;
        if (ev.response?.metadata?.topic !== 'session_review') onStatus?.('speaking');
        break;
      case 'response.done':
        {
          responseActive = false;
          const calls = (ev.response?.output || []).filter(item => item.type === 'function_call');
          const reviewCall = calls.find(item => item.name === SESSION_REVIEW_TOOL.name);
          if (ev.response?.metadata?.topic === 'session_review' || (reviewRequest && reviewCall)) {
            if (!reviewRequest) break;
            const pending = reviewRequest;
            reviewRequest = null;
            clearTimeout(pending.timer);
            if (!reviewCall) {
              pending.reject(new Error('Realtime Tutor 没有返回结构化复盘'));
              break;
            }
            try {
              pending.resolve(JSON.parse(reviewCall.arguments || '{}'));
            } catch {
              pending.reject(new Error('Realtime Tutor 的复盘格式无法解析'));
            }
            break;
          }
          if (calls.length) {
            onStatus?.('thinking');
            handleFunctionCalls(calls).catch(error => onError?.(error.message || 'Tutor 工具执行失败'));
          } else {
            onStatus?.('idle');
          }
        }
        break;
      case 'response.cancelled':
        responseActive = false;
        if (!reviewRequest) onStatus?.('idle');
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (ev.transcript?.trim()) onUserText?.(ev.transcript.trim());
        break;
      case 'response.output_audio_transcript.delta':
        onAIDelta?.(ev.delta || '');
        break;
      case 'response.output_audio_transcript.done':
        onAIDone?.((ev.transcript || '').trim());
        break;
      case 'error':
        if (reviewRequest) {
          const pending = reviewRequest;
          reviewRequest = null;
          clearTimeout(pending.timer);
          pending.reject(new Error(ev.error?.message || 'Realtime 语音复盘失败'));
        }
        onError?.(ev.error?.message || '实时连接出错');
        break;
      default:
        break;
    }
  });
  dc.addEventListener('close', () => {
    if (!stopped) onStatus?.('disconnected');
  });
  pc.addEventListener('connectionstatechange', () => {
    if (['failed', 'disconnected'].includes(pc.connectionState) && !stopped) {
      onStatus?.('disconnected');
      onError?.('语音连接已中断，请结束课程后重新连接');
    }
  });

  async function handleFunctionCalls(calls) {
    for (const call of calls) {
      let output;
      try {
        const args = JSON.parse(call.arguments || '{}');
        if (!onToolCall) throw new Error('Tutor 工具尚未配置');
        const result = await onToolCall({ name: call.name, args });
        output = JSON.stringify({ ok: true, result });
      } catch (error) {
        output = JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      if (stopped || dc.readyState !== 'open') return;
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call.call_id,
          output,
        },
      }));
    }
    if (!stopped && dc.readyState === 'open') {
      dc.send(JSON.stringify({
        type: 'response.create',
        response: {},
      }));
    }
  }

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const answerSDP = await createRealtimeCall({
      sdp: offer.sdp,
      apiKey: (apiKey || '').trim(),
      instructions,
      voice: selectedVoice,
      inputLanguage,
    });
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSDP });
    durationDeadline = Date.now() + maxDurationMs;
    onTimeRemaining?.(Math.ceil(maxDurationMs / 1000));
    durationTimer = setInterval(() => {
      if (stopped) return;
      const seconds = Math.max(0, Math.ceil((durationDeadline - Date.now()) / 1000));
      onTimeRemaining?.(seconds);
      if (seconds <= 0) {
        clearInterval(durationTimer);
        durationTimer = null;
        if (onTimeLimit) onTimeLimit();
        else stop();
      }
    }, 1000);
  } catch (error) {
    stop();
    throw error;
  }

  function setMuted(muted) {
    stream?.getAudioTracks().forEach(track => { track.enabled = !muted; });
    return muted;
  }

  function sendEvent(payload) {
    if (stopped || dc.readyState !== 'open') return false;
    dc.send(JSON.stringify(payload));
    return true;
  }

  function startTalking() {
    if (stopped || dc.readyState !== 'open' || talking) return false;
    talkCycle += 1;
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = null;
    talking = true;
    talkStartedAt = performance.now();
    sendEvent({ type: 'input_audio_buffer.clear' });
    if (responseActive) sendEvent({ type: 'response.cancel' });
    sendEvent({ type: 'output_audio_buffer.clear' });
    setMuted(false);
    onStatus?.('listening');
    return true;
  }

  function stopTalking() {
    if (stopped || !talking) return false;
    talking = false;
    setMuted(true);
    const cycle = talkCycle;
    const duration = performance.now() - talkStartedAt;
    if (duration < 220) {
      sendEvent({ type: 'input_audio_buffer.clear' });
      onStatus?.('idle');
      return false;
    }
    onStatus?.('thinking');
    commitTimer = setTimeout(() => {
      commitTimer = null;
      if (stopped || talking || cycle !== talkCycle) return;
      sendEvent({ type: 'input_audio_buffer.commit' });
      sendEvent({ type: 'session.update', session: { instructions } });
      sendEvent({ type: 'response.create', response: {} });
    }, 90);
    return true;
  }

  function requestSessionReview({ timeoutMs = 12_000 } = {}) {
    if (stopped || dc.readyState !== 'open') return Promise.reject(new Error('Realtime 会话已经结束'));
    if (reviewRequest) return reviewRequest.promise;
    talking = false;
    setMuted(true);
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = null;
    sendEvent({ type: 'input_audio_buffer.clear' });
    if (responseActive) sendEvent({ type: 'response.cancel' });
    sendEvent({ type: 'output_audio_buffer.clear' });
    onStatus?.('reviewingVoice');

    let resolveRequest;
    let rejectRequest;
    const promise = new Promise((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    const timer = setTimeout(() => {
      if (!reviewRequest) return;
      reviewRequest = null;
      rejectRequest(new Error('Realtime 语音复盘超时'));
    }, Math.max(4_000, Number(timeoutMs) || 12_000));
    reviewRequest = { promise, resolve: resolveRequest, reject: rejectRequest, timer };
    const sent = sendEvent({
      type: 'response.create',
      response: {
        conversation: 'none',
        metadata: { topic: 'session_review' },
        output_modalities: ['text'],
        instructions: `Review the Japanese tutoring session that just ended. You directly heard the learner's audio and have the full conversation context. Use that audio understanding as primary evidence; automatic transcription may be inaccurate, so do not quote uncertain wording or manufacture exact pronunciation claims. Evaluate communication, listening responses, fluency, vocabulary, grammar, and naturalness. When the audio provides clear repeated evidence, include at most one cautious, practical note about intelligibility, rhythm, long vowels, or geminate consonants within strengths or improvements; otherwise omit pronunciation feedback entirely. Never claim laboratory-grade pitch, phoneme, or accent measurements. Write every explanation and meaning in ${reviewLanguage}; keep Japanese examples in Japanese. Select 3-6 useful words or expressions that the learner can add to spaced repetition. Call submit_session_review exactly once and produce no ordinary chat reply.`,
        tools: [SESSION_REVIEW_TOOL],
        tool_choice: 'required',
      },
    });
    if (!sent) {
      clearTimeout(timer);
      reviewRequest = null;
      rejectRequest(new Error('无法向 Realtime Tutor 请求复盘'));
    }
    return promise;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = null;
    if (durationTimer) clearInterval(durationTimer);
    durationTimer = null;
    if (reviewRequest) {
      const pending = reviewRequest;
      reviewRequest = null;
      clearTimeout(pending.timer);
      pending.reject(new Error('Realtime 会话已关闭'));
    }
    setMuted(true);
    try { dc.close(); } catch { /* noop */ }
    try { pc.close(); } catch { /* noop */ }
    stream?.getTracks().forEach(track => track.stop());
    audioEl.pause();
    audioEl.srcObject = null;
    audioEl.remove();
  }

  return { stop, setMuted, startTalking, stopTalking, requestSessionReview, isTalking: () => talking, maxDurationMs };
}

async function createRealtimeCall({ sdp, apiKey, instructions, voice, inputLanguage }) {
  // server.py 会用环境变量 OPENAI_API_KEY；本地个人版也接受浏览器设置中的 Key。
  let local = null;
  try {
    local = await fetch('/api/realtime/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sdp, apiKey, instructions, voice, inputLanguage }),
    });
  } catch {
    // 普通静态服务器没有桥接端点，继续走下方 BYOK 兼容路径。
  }
  if (local) {
    if (local.ok) return await local.text();
    if (![404, 405, 501].includes(local.status)) {
      const data = await local.json().catch(() => ({}));
      throw new Error(data.error || `Realtime 连接失败 (${local.status})`);
    }
  }

  if (!apiKey) {
    throw new Error('语音 Tutor 需要 OpenAI API Key。请在设置中填写，或给 server.py 配置 OPENAI_API_KEY。');
  }
  const direct = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(REALTIME_MODEL)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/sdp' },
    body: sdp,
  });
  if (!direct.ok) {
    const msg = (await direct.text().catch(() => '')).slice(0, 240);
    throw new Error(`Realtime 连接失败 (${direct.status})，请检查 OpenAI API Key 与 Realtime 权限。${msg}`);
  }
  return await direct.text();
}
