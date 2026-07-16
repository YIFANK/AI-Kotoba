import { ensureSchema, getRequestUser, json, sha256, signInRequired } from "../../../lib/server";

export const dynamic = "force-dynamic";
const MAX_SHARED_BYTES = 256 * 1024;
const SHARE_ID_PATTERN = /^[a-f0-9]{32}$/;

function shareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function serializedContent(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("分享内容格式无效");
  const jsonValue = JSON.stringify(value);
  if (!jsonValue || new TextEncoder().encode(jsonValue).byteLength > MAX_SHARED_BYTES) {
    throw new Error("分享内容过大，请缩短后重试");
  }
  const parsed = JSON.parse(jsonValue) as Record<string, unknown>;
  if (!String(parsed.title || "").trim()) throw new Error("分享内容缺少标题");
  return jsonValue;
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim().toLowerCase() || "";
  if (!SHARE_ID_PATTERN.test(id)) return json({ error: "分享链接无效" }, { status: 400 });
  try {
    const db = await ensureSchema();
    const row = await db.prepare(`SELECT id, content_type AS contentType, data_json AS dataJson,
        created_by_name AS createdByName, created_at AS createdAt
      FROM shared_content
      WHERE id = ? AND revoked_at IS NULL`)
      .bind(id)
      .first<{ id: string; contentType: string; dataJson: string; createdByName: string; createdAt: number }>();
    if (!row) return json({ error: "分享不存在或已被取消" }, { status: 404 });
    return json({
      id: row.id,
      type: row.contentType,
      content: JSON.parse(row.dataJson),
      sharedBy: row.createdByName,
      createdAt: Number(row.createdAt),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "读取分享失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = getRequestUser(request);
  if (!user) return signInRequired();
  try {
    const body = await request.json() as { type?: string; content?: unknown };
    const type = body.type === "article" ? "article" : body.type === "scenario" ? "scenario" : "";
    if (!type) return json({ error: "只能分享对话或文章" }, { status: 400 });
    const dataJson = serializedContent(body.content);
    const contentHash = await sha256(`${type}:${dataJson}`);
    const db = await ensureSchema();
    const existing = await db.prepare(`SELECT id FROM shared_content
      WHERE created_by = ? AND content_hash = ? AND revoked_at IS NULL
      ORDER BY created_at DESC LIMIT 1`)
      .bind(user.email, contentHash)
      .first<{ id: string }>();
    if (existing?.id) return json({ id: existing.id, type, reused: true });

    const id = shareId();
    const createdAt = Date.now();
    await db.prepare(`INSERT INTO shared_content
      (id, content_type, data_json, content_hash, created_by, created_by_name, created_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`)
      .bind(id, type, dataJson, contentHash, user.email, user.name, createdAt)
      .run();
    return json({ id, type, createdAt, reused: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建分享失败";
    return json({ error: message }, { status: /格式|标题|过大/.test(message) ? 400 : 500 });
  }
}

export async function DELETE(request: Request) {
  const user = getRequestUser(request);
  if (!user) return signInRequired();
  const id = new URL(request.url).searchParams.get("id")?.trim().toLowerCase() || "";
  if (!SHARE_ID_PATTERN.test(id)) return json({ error: "分享链接无效" }, { status: 400 });
  try {
    const db = await ensureSchema();
    const owned = await db.prepare("SELECT id FROM shared_content WHERE id = ? AND created_by = ? AND revoked_at IS NULL")
      .bind(id, user.email)
      .first<{ id: string }>();
    if (!owned) return json({ error: "找不到可取消的分享" }, { status: 404 });
    await db.prepare("UPDATE shared_content SET revoked_at = ? WHERE id = ? AND created_by = ?")
      .bind(Date.now(), id, user.email)
      .run();
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "取消分享失败" }, { status: 500 });
  }
}
