import {
  consumeDailyQuota,
  getEnv,
  getRequestUser,
  json,
  quotaExceeded,
  sha256,
  signInRequired,
} from "../../../../lib/server";

export const dynamic = "force-dynamic";
const DEFAULT_VOICES = {
  a: "Xb7hH8MSUJpSbSDYk0k2",
  b: "JBFqnCBsd6RMkjVDRZzb",
};

function cleanSpeechText(value: unknown): string {
  return String(value || "").replace(/\[[^\]\n]+\]/g, "").trim();
}

export async function POST(request: Request) {
  const user = getRequestUser(request);
  if (!user) return signInRequired();
  const runtime = getEnv();
  const apiKey = runtime.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return json({ error: "服务端尚未配置 ElevenLabs API Key" }, { status: 503 });
  try {
    const body = await request.json() as { text?: string; role?: string };
    const text = cleanSpeechText(body.text);
    if (!text) return json({ error: "没有可朗读的日语文本" }, { status: 400 });
    if (text.length > 1200) return json({ error: "单次朗读最多 1200 个字符，请按句播放" }, { status: 413 });
    const role = body.role === "b" ? "b" : "a";
    const voice = role === "b"
      ? (runtime.ELEVENLABS_JA_VOICE_B || DEFAULT_VOICES.b)
      : (runtime.ELEVENLABS_JA_VOICE_A || DEFAULT_VOICES.a);
    const model = runtime.ELEVENLABS_TTS_MODEL || "eleven_v3";
    const cacheKey = `tts/${await sha256(JSON.stringify({ version: 1, model, voice, text }))}.mp3`;
    const cached = await runtime.MEDIA?.get(cacheKey);
    if (cached?.body) {
      return new Response(cached.body, {
        headers: {
          "content-type": cached.httpMetadata?.contentType || "audio/mpeg",
          "cache-control": "public, max-age=31536000, immutable",
          "x-ai-kotoba-tts-cache": "hit",
          "x-ai-kotoba-tts-model": model,
        },
      });
    }

    const quota = await consumeDailyQuota(user, "tts");
    if (!quota.allowed) return quotaExceeded(quota);
    const requestBody: Record<string, unknown> = {
      text,
      model_id: model,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.15,
        use_speaker_boost: true,
      },
    };
    if (model !== "eleven_multilingual_v2") requestBody.language_code = "ja";
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify(requestBody),
      },
    );
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      return json({ error: `ElevenLabs TTS：${detail || response.statusText}` }, { status: response.status });
    }
    const audio = await response.arrayBuffer();
    if (!audio.byteLength) return json({ error: "ElevenLabs 返回了空音频" }, { status: 502 });
    await runtime.MEDIA?.put(cacheKey, audio, { httpMetadata: { contentType: "audio/mpeg" } });
    return new Response(audio, {
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "public, max-age=31536000, immutable",
        "x-ai-kotoba-tts-cache": "miss",
        "x-ai-kotoba-tts-model": model,
      },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "ElevenLabs TTS 失败" }, { status: 500 });
  }
}
