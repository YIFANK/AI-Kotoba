import { ensureSchema, getRequestUser, json, signInRequired } from "../../../lib/server";

export const dynamic = "force-dynamic";
const MAX_STATE_BYTES = 3 * 1024 * 1024;

export async function GET(request: Request) {
  const user = getRequestUser(request);
  if (!user) return signInRequired();
  try {
    const db = await ensureSchema();
    const row = await db
      .prepare("SELECT data_json AS dataJson FROM user_states WHERE user_email = ?")
      .bind(user.email)
      .first<{ dataJson: string }>();
    return json(row?.dataJson ? JSON.parse(row.dataJson) : {});
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "读取学习记录失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = getRequestUser(request);
  if (!user) return signInRequired();
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_STATE_BYTES) return json({ error: "学习记录过大" }, { status: 413 });
  try {
    const state = await request.json();
    const dataJson = JSON.stringify(state);
    if (new TextEncoder().encode(dataJson).byteLength > MAX_STATE_BYTES) {
      return json({ error: "学习记录过大" }, { status: 413 });
    }
    const db = await ensureSchema();
    await db
      .prepare(`INSERT INTO user_states (user_email, data_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_email) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`)
      .bind(user.email, dataJson, Date.now())
      .run();
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "保存学习记录失败" }, { status: 500 });
  }
}
