import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
