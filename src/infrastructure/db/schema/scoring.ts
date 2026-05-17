import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const cohortSummaries = sqliteTable("cohort_summaries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  computedAt: text("computed_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  scoringConfigVersion: text("scoring_config_version").notNull(),
  brandCount: integer("brand_count").notNull(),
  summaryJson: text("summary_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  trigger: text("trigger", { enum: ["scheduled", "manual", "data_threshold"] }).notNull(),
});

export const brandScoreHistory = sqliteTable("brand_score_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brandId: integer("brand_id").notNull(),
  computedAt: text("computed_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  scoringConfigVersion: text("scoring_config_version").notNull(),
  cohortSummaryId: integer("cohort_summary_id")
    .notNull()
    .references(() => cohortSummaries.id),
  scoresJson: text("scores_json", { mode: "json" })
    .$type<Record<string, number | null>>()
    .notNull(),
  inputsJson: text("inputs_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
});

export const brandScoreSnapshots = sqliteTable("brand_score_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brandId: integer("brand_id").notNull(),
  snapshotAt: text("snapshot_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  promotedFromHistoryId: integer("promoted_from_history_id")
    .notNull()
    .references((): AnySQLiteColumn => brandScoreHistory.id),
  cohortSummaryId: integer("cohort_summary_id")
    .notNull()
    .references(() => cohortSummaries.id),
  // jscpd:ignore-start — identical column definition required in both history and snapshot tables
  scoresJson: text("scores_json", { mode: "json" })
    .$type<Record<string, number | null>>()
    .notNull(),
  // jscpd:ignore-end
  isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
});
