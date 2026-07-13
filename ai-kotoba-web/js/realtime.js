// OpenAI Realtime API（WebRTC）语音 Tutor
// 优先通过本地 server.py 的统一接口建立会话；纯静态托管时保留 BYOK 直连兼容。
const REALTIME_MODEL = 'gpt-realtime-2.1';
const ALLOWED_VOICES = new Set(['marin', 'cedar']);
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

export async function startRealtimeSession({
  apiKey,
  instructions,
  voice = 'marin',
  onUserText,
  onAIDelta,
  onAIDone,
  onStatus,
  onError,
  onToolCall,
}) {
  const selectedVoice = ALLOWED_VOICES.has(voice) ? voice : 'marin';
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
  pc.addTrack(stream.getAudioTracks()[0], stream);

  const sessionConfig = {
    type: 'realtime',
    model: REALTIME_MODEL,
    output_modalities: ['audio'],
    instructions,
    audio: {
      input: {
        transcription: { model: 'gpt-realtime-whisper', language: 'ja', delay: 'low' },
        turn_detection: { type: 'semantic_vad' },
      },
      output: { voice: selectedVoice },
    },
    tools: TUTOR_TOOLS,
    tool_choice: 'auto',
  };

  let lessonStarted = false;
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
            response: {
              instructions: 'レッスンを始めてください。短く挨拶し、今日のテーマに合う最初の質問を一つだけしてください。',
            },
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
        onStatus?.('speaking');
        break;
      case 'response.done':
        {
          const calls = (ev.response?.output || []).filter(item => item.type === 'function_call');
          if (calls.length) {
            onStatus?.('thinking');
            handleFunctionCalls(calls).catch(error => onError?.(error.message || 'Tutor 工具执行失败'));
          } else {
            onStatus?.('idle');
          }
        }
        break;
      case 'response.cancelled':
        onStatus?.('idle');
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
        response: { instructions: 'ツールの実行結果を踏まえ、保存できたかどうかを日本語で一文だけ自然に伝えてから会話を続けてください。' },
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
    });
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSDP });
  } catch (error) {
    stop();
    throw error;
  }

  function setMuted(muted) {
    stream?.getAudioTracks().forEach(track => { track.enabled = !muted; });
    return muted;
  }

  function stop() {
    stopped = true;
    try { dc.close(); } catch { /* noop */ }
    try { pc.close(); } catch { /* noop */ }
    stream?.getTracks().forEach(track => track.stop());
    audioEl.pause();
    audioEl.srcObject = null;
    audioEl.remove();
  }

  return { stop, setMuted };
}

async function createRealtimeCall({ sdp, apiKey, instructions, voice }) {
  // server.py 会用环境变量 OPENAI_API_KEY；本地个人版也接受浏览器设置中的 Key。
  let local = null;
  try {
    local = await fetch('/api/realtime/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sdp, apiKey, instructions, voice }),
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
