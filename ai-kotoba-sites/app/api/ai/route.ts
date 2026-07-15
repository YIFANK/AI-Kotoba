import {
  consumeDailyQuota,
  getEnv,
  getRequestUser,
  json,
  quotaExceeded,
  readOpenAIError,
  sha256,
  signInRequired,
} from "../../../lib/server";

export const dynamic = "force-dynamic";
const DAILY_AI_REQUESTS = 30;

export async function POST(request: Request) {
  const user = getRequestUser(request);
  if (!user) return signInRequired();
  const runtime = getEnv();
  const apiKey = runtime.OPENAI_API_KEY?.trim();
  if (!apiKey) return json({ error: "服务端尚未配置 OpenAI API Key" }, { status: 503 });
  try {
    const body = await request.json() as { prompt?: string };
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return json({ error: "Prompt 不能为空" }, { status: 400 });
    if (prompt.length > 40_000) return json({ error: "Prompt 过长" }, { status: 413 });
    const quota = await consumeDailyQuota(user, "ai_text", DAILY_AI_REQUESTS);
    if (!quota.allowed) return quotaExceeded(quota.limit);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "openai-safety-identifier": await sha256(`ai-kotoba:${user.email}`),
      },
      body: JSON.stringify({
        model: runtime.OPENAI_FAST_MODEL || "gpt-4o-mini",
        store: false,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) return json({ error: await readOpenAIError(response) }, { status: response.status });
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = result.choices?.[0]?.message?.content?.trim() || "";
    if (!text) return json({ error: "模型返回内容为空" }, { status: 502 });
    return json({ text, usage: quota });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "AI 请求失败" }, { status: 500 });
  }
}
