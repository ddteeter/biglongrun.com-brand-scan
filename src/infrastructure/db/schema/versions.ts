import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, real, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { brands } from "./brands";

export const brandSizeChartVersions = sqliteTable("brand_size_chart_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brandId: integer("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  brandSourceId: integer("brand_source_id").notNull(),
  extractedAt: text("extracted_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  sourceRunId: integer("source_run_id"),
  sizeChartJson: text("size_chart_json", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
  confidenceScore: real("confidence_score").notNull(),
  confidenceBreakdownJson: text("confidence_breakdown_json", { mode: "json" })
    .$type<{ claudeReported: number; structuralValidation: number; cohortOutlier: number }>()
    .notNull(),
  status: text("status", {
    enum: ["pending_review", "accepted", "rejected", "superseded"],
  }).notNull(),
  acceptedAt: text("accepted_at"),
  acceptedBy: text("accepted_by"),
  rejectionReason: text("rejection_reason"),
  supersedesVersionId: integer("supersedes_version_id").references(
    (): AnySQLiteColumn => brandSizeChartVersions.id
  ),
  deltaFromPriorJson: text("delta_from_prior_json", { mode: "json" }).$type<
    Record<string, unknown>
  >(),
});
