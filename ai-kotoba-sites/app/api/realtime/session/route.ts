import {
  consumeDailyQuota,
  getEnv,
  getRequestUser,
  json,
  quotaExceeded,
  readOpenAIError,
  sha256,
  signInRequired,
} from "../../../../lib/server";

export const dynamic = "force-dynamic";
const DAILY_REALTIME_SESSIONS = 12;

export async function POST(request: Request) {
  const user = getRequestUser(request);
  if (!user) return signInRequired();
  const runtime = getEnv();
  const apiKey = runtime.OPENAI_API_KEY?.trim();
  if (!apiKey) return json({ error: "服务端尚未配置 OpenAI API Key" }, { status: 503 });
  try {
    const body = await request.json() as { sdp?: string; voice?: string; instructions?: string; inputLanguage?: string };
    const sdp = String(body.sdp || "");
    if (!sdp.startsWith("v=0")) return json({ error: "无效的 WebRTC SDP" }, { status: 400 });
    const voice = ["marin", "cedar"].includes(String(body.voice)) ? String(body.voice) : "marin";
    const instructions = String(body.instructions || "").slice(0, 12_000);
    const inputLanguage = String(body.inputLanguage || "ja").trim().toLowerCase();
    const transcription: Record<string, string> = { model: "gpt-realtime-whisper", delay: "low" };
    if (inputLanguage && inputLanguage !== "auto") transcription.language = inputLanguage;
    const quota = await consumeDailyQuota(user, "realtime", DAILY_REALTIME_SESSIONS);
    if (!quota.allowed) return quotaExceeded(quota.limit);
    const model = runtime.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";
    const session = {
      type: "realtime",
      model,
      output_modalities: ["audio"],
      instructions,
      audio: {
        input: {
          transcription,
          turn_detection: { type: "semantic_vad" },
        },
        output: { voice },
      },
    };
    const form = new FormData();
    form.set("sdp", sdp);
    form.set("session", JSON.stringify(session));
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "openai-safety-identifier": await sha256(`ai-kotoba:${user.email}`),
      },
      body: form,
    });
    if (!response.ok) return json({ error: await readOpenAIError(response) }, { status: response.status });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": "application/sdp", "cache-control": "no-store" },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Realtime 会话创建失败" }, { status: 500 });
  }
}
