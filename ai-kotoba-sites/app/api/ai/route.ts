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

const grammarLessonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "meaning", "explanation", "formation", "pitfall", "examples", "quiz"],
  properties: {
    title: { type: "string" },
    meaning: { type: "string" },
    explanation: { type: "string" },
    formation: { type: "string" },
    pitfall: { type: "string" },
    examples: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["japanese", "translation", "note"],
        properties: {
          japanese: { type: "string" },
          translation: { type: "string" },
          note: { type: "string" },
        },
      },
    },
    quiz: {
      type: "object",
      additionalProperties: false,
      required: ["prompt", "answer", "explanation"],
      properties: {
        prompt: { type: "string" },
        answer: { type: "string" },
        explanation: { type: "string" },
      },
    },
  },
} as const;

const tutorReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "strengths", "improvements", "usefulPhrases", "grammarEvidence", "nextStep"],
  properties: {
    summary: { type: "string" },
    strengths: { type: "array", maxItems: 3, items: { type: "string" } },
    improvements: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["original", "better", "explanation"],
        properties: { original: { type: "string" }, better: { type: "string" }, explanation: { type: "string" } },
      },
    },
    usefulPhrases: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["japanese", "reading", "meaning", "example", "exampleTranslation"],
        properties: {
          japanese: { type: "string" },
          reading: { type: "string" },
          meaning: { type: "string" },
          example: { type: "string" },
          exampleTranslation: { type: "string" },
        },
      },
    },
    grammarEvidence: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pattern", "level", "result", "note"],
        properties: {
          pattern: { type: "string" },
          level: { type: "string", enum: ["N5", "N4", "N3", "unknown"] },
          result: { type: "string", enum: ["used-well", "needs-work"] },
          note: { type: "string" },
        },
      },
    },
    nextStep: { type: "string" },
  },
} as const;

const placementDimensionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "level", "confidence", "evidence", "nextStep"],
  properties: {
    score: { type: "number", minimum: 0, maximum: 100 },
    level: { type: "string", enum: ["N5", "N4", "N3", "N2", "N1"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: { type: "array", maxItems: 3, items: { type: "string" } },
    nextStep: { type: "string" },
  },
} as const;

const oralPlacementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["recommendedLevel", "confidence", "summary", "dimensions", "canDo", "priorities", "caveats", "tutorAdaptation"],
  properties: {
    recommendedLevel: { type: "string", enum: ["N5", "N4", "N3", "N2", "N1"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    summary: { type: "string" },
    dimensions: {
      type: "object",
      additionalProperties: false,
      required: ["listening", "speaking", "fluency", "vocabulary", "grammar", "interaction", "organization"],
      properties: {
        listening: placementDimensionSchema,
        speaking: placementDimensionSchema,
        fluency: placementDimensionSchema,
        vocabulary: placementDimensionSchema,
        grammar: placementDimensionSchema,
        interaction: placementDimensionSchema,
        organization: placementDimensionSchema,
      },
    },
    canDo: { type: "array", maxItems: 3, items: { type: "string" } },
    priorities: { type: "array", maxItems: 3, items: { type: "string" } },
    caveats: { type: "array", maxItems: 3, items: { type: "string" } },
    tutorAdaptation: {
      type: "object",
      additionalProperties: false,
      required: ["speechPace", "japaneseComplexity", "correctionFrequency", "supportLanguage", "instructions"],
      properties: {
        speechPace: { type: "string", enum: ["slow", "natural-slow", "natural"] },
        japaneseComplexity: { type: "string", enum: ["N5", "N4", "N3", "N2", "N1"] },
        correctionFrequency: { type: "string", enum: ["low", "medium", "high"] },
        supportLanguage: { type: "string", enum: ["minimal", "when-blocked", "frequent"] },
        instructions: { type: "string" },
      },
    },
  },
} as const;

function structuredResponseFormat(schemaName: string) {
  const schema = schemaName === "grammar_lesson"
    ? grammarLessonSchema
    : schemaName === "tutor_review"
      ? tutorReviewSchema
      : schemaName === "oral_placement"
        ? oralPlacementSchema
      : null;
  return schema ? { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } } : undefined;
}

export async function POST(request: Request) {
  const user = getRequestUser(request);
  if (!user) return signInRequired();
  const runtime = getEnv();
  const apiKey = runtime.OPENAI_API_KEY?.trim();
  if (!apiKey) return json({ error: "服务端尚未配置 OpenAI API Key" }, { status: 503 });
  try {
    const body = await request.json() as { prompt?: string; schema?: string };
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return json({ error: "Prompt 不能为空" }, { status: 400 });
    if (prompt.length > 40_000) return json({ error: "Prompt 过长" }, { status: 413 });
    const quota = await consumeDailyQuota(user, "ai_text");
    if (!quota.allowed) return quotaExceeded(quota);
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
        response_format: structuredResponseFormat(String(body.schema || "")),
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
