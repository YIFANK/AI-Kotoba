import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const userStates = sqliteTable("user_states", {
  userEmail: text("user_email").primaryKey(),
  dataJson: text("data_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const dailyUsage = sqliteTable(
  "daily_usage",
  {
    userEmail: text("user_email").notNull(),
    bucket: text("bucket").notNull(),
    day: text("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userEmail, table.bucket, table.day] })],
);

export const sharedContent = sqliteTable(
  "shared_content",
  {
    id: text("id").primaryKey(),
    contentType: text("content_type").notNull(),
    dataJson: text("data_json").notNull(),
    contentHash: text("content_hash").notNull(),
    createdBy: text("created_by").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: integer("created_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (table) => [index("shared_content_creator_hash_idx").on(table.createdBy, table.contentHash)],
);
