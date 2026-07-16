import {
  ensureSchema,
  getRequestUser,
  isAdminUser,
  json,
  quotaDefinitions,
  signInRequired,
} from "../../../../lib/server";

export const dynamic = "force-dynamic";

type UsageRow = { userEmail: string; bucket: string; count: number };
type GlobalRow = { day: string; bucket: string; count: number };

export async function GET(request: Request) {
  const user = getRequestUser(request);
  if (!user) return signInRequired();
  if (!isAdminUser(user)) return json({ error: "仅站点管理员可以查看用量。" }, { status: 403 });

  try {
    const db = await ensureSchema();
    const today = new Date().toISOString().slice(0, 10);
    const historyStart = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const [globalResult, userResult, historyResult, totalUsersRow] = await Promise.all([
      db.prepare(`SELECT bucket, count
        FROM daily_usage
        WHERE user_email = '__global__' AND day = ?`)
        .bind(today)
        .all<{ bucket: string; count: number }>(),
      db.prepare(`SELECT user_email AS userEmail, bucket, count
        FROM daily_usage
        WHERE day = ? AND user_email <> '__global__'
        ORDER BY user_email, bucket`)
        .bind(today)
        .all<UsageRow>(),
      db.prepare(`SELECT day, bucket, count
        FROM daily_usage
        WHERE user_email = '__global__' AND day >= ?
        ORDER BY day, bucket`)
        .bind(historyStart)
        .all<GlobalRow>(),
      db.prepare("SELECT COUNT(*) AS count FROM user_states").first<{ count: number }>(),
    ]);

    const globalCounts = new Map((globalResult.results || []).map((row) => [row.bucket, Number(row.count || 0)]));
    const buckets = quotaDefinitions().map((definition) => {
      const used = globalCounts.get(definition.bucket) || 0;
      return {
        ...definition,
        used,
        remaining: Math.max(0, definition.globalLimit - used),
        percent: Math.min(100, Math.round((used / definition.globalLimit) * 100)),
        realtimeMaxMinutes: definition.bucket === "realtime" ? 12 : undefined,
      };
    });

    const users = new Map<string, { email: string; total: number; usage: Record<string, number> }>();
    for (const row of userResult.results || []) {
      const entry = users.get(row.userEmail) || { email: row.userEmail, total: 0, usage: {} };
      const count = Number(row.count || 0);
      entry.usage[row.bucket] = count;
      entry.total += count;
      users.set(row.userEmail, entry);
    }

    const historyByDay = new Map<string, Record<string, number>>();
    for (const row of historyResult.results || []) {
      const entry = historyByDay.get(row.day) || {};
      entry[row.bucket] = Number(row.count || 0);
      historyByDay.set(row.day, entry);
    }

    return json({
      day: today,
      timezone: "UTC",
      resetAt: `${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`,
      totalUsers: Number(totalUsersRow?.count || 0),
      activeUsers: users.size,
      buckets,
      users: Array.from(users.values()).sort((a, b) => b.total - a.total),
      history: Array.from(historyByDay.entries()).map(([day, usage]) => ({ day, usage })),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "读取用量失败" }, { status: 500 });
  }
}
