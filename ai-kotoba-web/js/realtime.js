// OpenAI Realtime API（WebRTC）语音自由对话
// 浏览器直连：麦克风上行 + AI 语音下行 + 数据通道收发转写事件
export async function startRealtimeSession({ apiKey, instructions, onUserText, onAIDelta, onAIDone, onStatus, onError }) {
  const pc = new RTCPeerConnection();
  const audioEl = document.createElement('audio');
  audioEl.autoplay = true;
  pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    pc.close();
    throw new Error('无法访问麦克风，请在浏览器中允许麦克风权限');
  }
  pc.addTrack(stream.getTracks()[0], stream);

  let ga = true; // GA 接口（gpt-realtime）；失败时回退 beta 接口
  const dc = pc.createDataChannel('oai-events');
  dc.addEventListener('open', () => {
    const session = ga
      ? {
          type: 'realtime',
          instructions,
          audio: { input: { transcription: { model: 'whisper-1' } }, output: { voice: 'marin' } },
        }
      : {
          instructions,
          voice: 'alloy',
          input_audio_transcription: { model: 'whisper-1' },
        };
    dc.send(JSON.stringify({ type: 'session.update', session }));
    onStatus?.('idle');
  });
  dc.addEventListener('message', (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        onStatus?.('listening');
        break;
      case 'response.created':
        onStatus?.('speaking');
        break;
      case 'response.done':
        onStatus?.('idle');
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (ev.transcript?.trim()) onUserText?.(ev.transcript.trim());
        break;
      case 'response.output_audio_transcript.delta': // GA
      case 'response.audio_transcript.delta': // beta
        onAIDelta?.(ev.delta || '');
        break;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        onAIDone?.((ev.transcript || '').trim());
        break;
      case 'error':
        onError?.(ev.error?.message || '实时连接出错');
        break;
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const sdpHeaders = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/sdp' };
  let res = await fetch('https://api.openai.com/v1/realtime/calls?model=gpt-realtime', {
    method: 'POST', headers: sdpHeaders, body: offer.sdp,
  });
  if (!res.ok) {
    ga = false;
    res = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview', {
      method: 'POST', headers: { ...sdpHeaders, 'OpenAI-Beta': 'realtime=v1' }, body: offer.sdp,
    });
  }
  if (!res.ok) {
    const msg = (await res.text().catch(() => '')).slice(0, 200);
    stop();
    throw new Error(`Realtime 连接失败 (${res.status})，请检查 OpenAI API Key 是否有 Realtime 权限。${msg}`);
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });

  function stop() {
    try { dc.close(); } catch { /* noop */ }
    try { pc.close(); } catch { /* noop */ }
    stream?.getTracks().forEach(t => t.stop());
    audioEl.srcObject = null;
  }
  return { stop };
}
