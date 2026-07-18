import { getEnv, json } from "../../../lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = getEnv();
  return json({
    hosted: true,
    claude: false,
    codex: false,
    openai_text: Boolean(runtime.OPENAI_API_KEY),
    openai_realtime: Boolean(runtime.OPENAI_API_KEY),
    openai_fast_model: runtime.OPENAI_FAST_MODEL || "gpt-4o-mini",
    elevenlabs_tts: Boolean(runtime.ELEVENLABS_API_KEY),
    elevenlabs_model: runtime.ELEVENLABS_TTS_MODEL || "eleven_v3",
    elevenlabs_japanese_voices_configured: Boolean(runtime.ELEVENLABS_JA_VOICE_A || runtime.ELEVENLABS_JA_VOICE_B),
    sudachipy: false,
  });
}
