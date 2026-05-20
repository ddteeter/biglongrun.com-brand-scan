import { sql } from "drizzle-orm";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { brands } from "./brands";

export interface AssessmentRatings {
  size_options: number;
  tier_equity: number;
  pricing_equity: number;
  fit_label_honesty: number;
  overall_inclusivity: number;
}

export const authorBrandAssessments = sqliteTable("author_brand_assessments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brandId: integer("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  authorSlug: text("author_slug").notNull(),
  assessmentDate: text("assessment_date")
    .notNull()
    .default(sql`(date('now'))`),
  ratingsJson: text("ratings_json", { mode: "json" }).$type<AssessmentRatings>().notNull(),
  proseMarkdown: text("prose_markdown").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
