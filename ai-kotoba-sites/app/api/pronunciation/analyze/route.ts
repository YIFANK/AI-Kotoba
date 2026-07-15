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
const DAILY_PRONUNCIATION_CHECKS = 15;

function analysisPrompt(target: string, level: string, nativeLanguage: string, explanationLanguage: string) {
  return `Analyze a ${nativeLanguage}-speaking JLPT ${level} learner reading this Japanese sentence:

Target: ${target}

Focus on audible intelligibility, long vowels, geminate consonants, moraic nasal, voicing, mora timing, pauses, and fluency. Pitch-accent comments must be cautious listening impressions, never laboratory measurements. Write all feedback in ${explanationLanguage}; keep Japanese transcripts and drills in Japanese. Return only:
{
  "transcript": "Japanese you actually heard",
  "overallScore": 0,
  "dimensions": {
    "intelligibility": {"score": 0, "feedback": "short feedback"},
    "sounds": {"score": 0, "feedback": "short feedback"},
    "rhythm": {"score": 0, "feedback": "short feedback"},
    "fluency": {"score": 0, "feedback": "short feedback"},
    "prosody": {"score": 0, "feedback": "cautious feedback"}
  },
  "strengths": ["up to 3 specific strengths"],
  "issues": [{"segment": "Japanese segment", "type": "issue type", "heard": "what it sounded like", "advice": "advice", "drill": "minimal Japanese drill"}],
  "summary": "2-sentence summary",
  "practicePlan": ["up to 3 next exercises"]
}`;
}

function parseJSONObject(value: string): Record<string, unknown> {
  const block = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || value;
  const start = block.indexOf("{");
  const end = block.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("音频模型没有返回有效诊断结果");
  return JSON.parse(block.slice(start, end + 1)) as Record<string, unknown>;
}

export async function POST(request: Request) {
  const user = getRequestUser(request);
  if (!user) return signInRequired();
  const runtime = getEnv();
  const apiKey = runtime.OPENAI_API_KEY?.trim();
  if (!apiKey) return json({ error: "服务端尚未配置 OpenAI API Key" }, { status: 503 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 9 * 1024 * 1024) return json({ error: "录音请求过大，请控制在 20 秒以内" }, { status: 413 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const target = String(body.target || "").trim().slice(0, 240);
    const level = ["N5", "N4", "N3", "N2", "N1"].includes(String(body.level)) ? String(body.level) : "N4";
    const nativeLanguage = String(body.nativeLanguage || "Chinese").trim().slice(0, 80);
    const explanationLanguage = String(body.explanationLanguage || "Simplified Chinese").trim().slice(0, 80);
    const audio = String(body.audio || "");
    if (!target || !audio) return json({ error: "请先填写目标句并完成录音" }, { status: 400 });
    const quota = await consumeDailyQuota(user, "pronunciation", DAILY_PRONUNCIATION_CHECKS);
    if (!quota.allowed) return quotaExceeded(quota.limit);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "openai-safety-identifier": await sha256(`ai-kotoba:${user.email}`),
      },
      body: JSON.stringify({
        model: runtime.OPENAI_AUDIO_MODEL || "gpt-audio-1.5",
        store: false,
        messages: [
          {
            role: "developer",
            content: "You are a careful Japanese pronunciation coach. Assess only what is audible. Do not claim laboratory-grade pitch or phoneme measurements. Return valid JSON only.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: analysisPrompt(target, level, nativeLanguage, explanationLanguage) },
              { type: "input_audio", input_audio: { data: audio, format: "wav" } },
            ],
          },
        ],
      }),
    });
    if (!response.ok) return json({ error: await readOpenAIError(response) }, { status: response.status });
    const result = await response.json() as { model?: string; choices?: Array<{ message?: { content?: string } }> };
    const content = result.choices?.[0]?.message?.content || "";
    return json({ analysis: parseJSONObject(content), model: result.model, usage: quota });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "发音诊断失败" }, { status: 500 });
  }
}
