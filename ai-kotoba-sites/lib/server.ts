import { env } from "cloudflare:workers";

type D1Result<T> = { results?: T[] };

type PreparedStatement = {
  bind(...values: unknown[]): PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<T>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
};

type Database = {
  prepare(sql: string): PreparedStatement;
  batch(statements: PreparedStatement[]): Promise<unknown>;
};

type ObjectBody = {
  body: ReadableStream | null;
  httpMetadata?: { contentType?: string };
};

type ObjectBucket = {
  get(key: string): Promise<ObjectBody | null>;
  put(key: string, value: ArrayBuffer | ReadableStream, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
};

export type AppEnv = {
  DB?: Database;
  MEDIA?: ObjectBucket;
  OPENAI_API_KEY?: string;
  OPENAI_FAST_MODEL?: string;
  OPENAI_AUDIO_MODEL?: string;
  OPENAI_REALTIME_MODEL?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_TTS_MODEL?: string;
  ELEVENLABS_JA_VOICE_A?: string;
  ELEVENLABS_JA_VOICE_B?: string;
  ADMIN_EMAILS?: string;
  GLOBAL_DAILY_AI_REQUESTS?: string;
  GLOBAL_DAILY_REALTIME_SESSIONS?: string;
  GLOBAL_DAILY_PRONUNCIATION_CHECKS?: string;
  GLOBAL_DAILY_TTS_GENERATIONS?: string;
};

export type RequestUser = {
  email: string;
  name: string;
};

let schemaReady: Promise<void> | null = null;
const GLOBAL_USAGE_EMAIL = "__global__";

export type QuotaBucket = "ai_text" | "realtime" | "pronunciation" | "tts";

export type QuotaResult = {
  allowed: boolean;
  count: number;
  limit: number;
  scope?: "user" | "global";
  global: { count: number; limit: number };
};

const QUOTA_DEFAULTS: Record<QuotaBucket, { label: string; unit: string; perUser: number; global: number }> = {
  ai_text: { label: "文本 AI", unit: "次", perUser: 30, global: 300 },
  realtime: { label: "Realtime Tutor", unit: "次", perUser: 12, global: 30 },
  pronunciation: { label: "发音诊断", unit: "次", perUser: 15, global: 100 },
  tts: { label: "ElevenLabs TTS", unit: "次新生成", perUser: 120, global: 300 },
};

const QUOTA_ENV_KEYS: Record<QuotaBucket, keyof AppEnv> = {
  ai_text: "GLOBAL_DAILY_AI_REQUESTS",
  realtime: "GLOBAL_DAILY_REALTIME_SESSIONS",
  pronunciation: "GLOBAL_DAILY_PRONUNCIATION_CHECKS",
  tts: "GLOBAL_DAILY_TTS_GENERATIONS",
};

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function quotaDefinitions(runtime: AppEnv = getEnv()) {
  return (Object.keys(QUOTA_DEFAULTS) as QuotaBucket[]).map((bucket) => {
    const defaults = QUOTA_DEFAULTS[bucket];
    return {
      bucket,
      label: defaults.label,
      unit: defaults.unit,
      perUserLimit: defaults.perUser,
      globalLimit: positiveInteger(runtime[QUOTA_ENV_KEYS[bucket]], defaults.global),
    };
  });
}

export function getEnv(): AppEnv {
  return env as unknown as AppEnv;
}

export function getRequestUser(request: Request): RequestUser | null {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!email) return null;
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  let name = email;
  if (encodedName && encoding === "percent-encoded-utf-8") {
    try {
      name = decodeURIComponent(encodedName);
    } catch {
      name = email;
    }
  }
  return { email, name };
}

export function isAdminUser(user: RequestUser | null, runtime: AppEnv = getEnv()): boolean {
  if (!user) return false;
  const allowed = String(runtime.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(user.email);
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function signInRequired(): Response {
  return json(
    {
      error: "请先点击右上角“用 ChatGPT 登录”，登录后即可使用 AI 功能并跨设备保存学习记录。",
      signin_url: "/signin-with-chatgpt?return_to=%2FAI_kotoba_newUI%2FAI-Kotoba.dc.html",
    },
    { status: 401 },
  );
}

export async function ensureSchema(): Promise<Database> {
  const db = getEnv().DB;
  if (!db) throw new Error("D1 binding DB is unavailable");
  schemaReady ??= (async () => {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS user_states (
        user_email TEXT PRIMARY KEY NOT NULL,
        data_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS daily_usage (
        user_email TEXT NOT NULL,
        bucket TEXT NOT NULL,
        day TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_email, bucket, day)
      )`),
    ]);
  })();
  await schemaReady;
  return db;
}

export async function consumeDailyQuota(
  user: RequestUser,
  bucket: QuotaBucket,
): Promise<QuotaResult> {
  const db = await ensureSchema();
  const day = new Date().toISOString().slice(0, 10);
  const definition = quotaDefinitions().find((item) => item.bucket === bucket);
  if (!definition) throw new Error(`Unknown quota bucket: ${bucket}`);
  const currentUser = await db
    .prepare("SELECT count FROM daily_usage WHERE user_email = ? AND bucket = ? AND day = ?")
    .bind(user.email, bucket, day)
    .first<{ count: number }>();
  const userCount = Number(currentUser?.count || 0);
  const currentGlobal = await db
    .prepare("SELECT count FROM daily_usage WHERE user_email = ? AND bucket = ? AND day = ?")
    .bind(GLOBAL_USAGE_EMAIL, bucket, day)
    .first<{ count: number }>();
  const globalCount = Number(currentGlobal?.count || 0);
  const global = { count: globalCount, limit: definition.globalLimit };
  if (userCount >= definition.perUserLimit) {
    return { allowed: false, count: userCount, limit: definition.perUserLimit, scope: "user", global };
  }
  if (globalCount >= definition.globalLimit) {
    return { allowed: false, count: userCount, limit: definition.perUserLimit, scope: "global", global };
  }

  const reserved = await db
    .prepare(`INSERT INTO daily_usage (user_email, bucket, day, count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_email, bucket, day) DO UPDATE SET count = daily_usage.count + 1
      WHERE daily_usage.count < ?
      RETURNING count`)
    .bind(GLOBAL_USAGE_EMAIL, bucket, day, definition.globalLimit)
    .first<{ count: number }>();
  if (!reserved) {
    const latest = await db
      .prepare("SELECT count FROM daily_usage WHERE user_email = ? AND bucket = ? AND day = ?")
      .bind(GLOBAL_USAGE_EMAIL, bucket, day)
      .first<{ count: number }>();
    return {
      allowed: false,
      count: userCount,
      limit: definition.perUserLimit,
      scope: "global",
      global: { count: Number(latest?.count || definition.globalLimit), limit: definition.globalLimit },
    };
  }

  const consumed = await db
    .prepare(`INSERT INTO daily_usage (user_email, bucket, day, count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_email, bucket, day) DO UPDATE SET count = daily_usage.count + 1
      WHERE daily_usage.count < ?
      RETURNING count`)
    .bind(user.email, bucket, day, definition.perUserLimit)
    .first<{ count: number }>();
  if (!consumed) {
    return {
      allowed: false,
      count: userCount,
      limit: definition.perUserLimit,
      scope: "user",
      global: { count: Number(reserved.count), limit: definition.globalLimit },
    };
  }
  return {
    allowed: true,
    count: Number(consumed.count),
    limit: definition.perUserLimit,
    global: { count: Number(reserved.count), limit: definition.globalLimit },
  };
}

export function quotaExceeded(quota: QuotaResult): Response {
  const error = quota.scope === "global"
    ? `今天的全站 AI 预算已用完（${quota.global.limit} 次）。明天会自动恢复。`
    : `你今天的公测额度已用完（${quota.limit} 次）。明天会自动恢复。`;
  return json({ error, usage: quota }, { status: 429 });
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readOpenAIError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return String(body?.error?.message || `OpenAI API error (${response.status})`).slice(0, 500);
}
