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
};

export type RequestUser = {
  email: string;
  name: string;
};

let schemaReady: Promise<void> | null = null;

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
  bucket: string,
  limit: number,
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const db = await ensureSchema();
  const day = new Date().toISOString().slice(0, 10);
  const current = await db
    .prepare("SELECT count FROM daily_usage WHERE user_email = ? AND bucket = ? AND day = ?")
    .bind(user.email, bucket, day)
    .first<{ count: number }>();
  const count = Number(current?.count || 0);
  if (count >= limit) return { allowed: false, count, limit };
  await db
    .prepare(`INSERT INTO daily_usage (user_email, bucket, day, count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_email, bucket, day) DO UPDATE SET count = count + 1`)
    .bind(user.email, bucket, day)
    .run();
  return { allowed: true, count: count + 1, limit };
}

export function quotaExceeded(limit: number): Response {
  return json({ error: `今天的公测额度已用完（${limit} 次）。明天会自动恢复。` }, { status: 429 });
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readOpenAIError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return String(body?.error?.message || `OpenAI API error (${response.status})`).slice(0, 500);
}
