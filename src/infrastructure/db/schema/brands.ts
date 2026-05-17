import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const brands = sqliteTable("brands", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  primaryUrl: text("primary_url").notNull(),
  categoryTag: text("category_tag").notNull().default("running"),
  audienceTags: text("audience_tags", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  currentSizeChartVersionId: integer("current_size_chart_version_id"),
  divergenceFlag: integer("divergence_flag", { mode: "boolean" }).notNull().default(false),
  predictedNextChangeAt: text("predicted_next_change_at"),
  cadenceLearnedAt: text("cadence_learned_at"),
  observedChangeIntervals: text("observed_change_intervals", { mode: "json" }).$type<number[]>(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  archivedAt: text("archived_at"),
});

export const brandSources = sqliteTable(
  "brand_sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    sourceType: text("source_type", {
      enum: ["size_chart", "catalog_root", "shopify_feed"],
    }).notNull(),
    cadenceSecondsOverride: integer("cadence_seconds_override"),
    lastEtag: text("last_etag"),
    lastModifiedHeader: text("last_modified_header"),
    lastFetchHash: text("last_fetch_hash"),
    lastFetchedAt: text("last_fetched_at"),
    lastChangedAt: text("last_changed_at"),
  },
  (t) => [uniqueIndex("brand_sources_brand_url_unique").on(t.brandId, t.url)]
);
