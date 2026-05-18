import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brands } from "./brands";

export const brandItems = sqliteTable(
  "brand_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    sourceUrl: text("source_url").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    tierClassification: text("tier_classification", {
      enum: ["flagship", "mid", "basic", "unclassified"],
    })
      .notNull()
      .default("unclassified"),
    tierInferredBy: text("tier_inferred_by"),
    tierRationale: text("tier_rationale"),
    basePriceUsd: real("base_price_usd"),
    perSizeDataJson: text("per_size_data_json", { mode: "json" })
      .$type<Record<string, { available: boolean; price?: number; colors?: string[] }>>()
      .notNull()
      .default(sql`'{}'`),
    firstSeenAt: text("first_seen_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    lastVerifiedAt: text("last_verified_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    isDiscontinued: integer("is_discontinued", { mode: "boolean" }).notNull().default(false),
    discontinuedAt: text("discontinued_at"),
    lastEtag: text("last_etag"),
    lastModifiedHeader: text("last_modified_header"),
    lastFetchHash: text("last_fetch_hash"),
    lastFetchedAt: text("last_fetched_at"),
  },
  (t) => [uniqueIndex("brand_items_brand_url_unique").on(t.brandId, t.sourceUrl)]
);

export const brandItemChanges = sqliteTable("brand_item_changes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id")
    .notNull()
    .references(() => brandItems.id, { onDelete: "cascade" }),
  changedAt: text("changed_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  changeType: text("change_type", {
    enum: ["size_added", "tier_reclassified", "discontinued", "price_changed", "added"],
  }).notNull(),
  beforeJson: text("before_json", { mode: "json" }).$type<Record<string, unknown>>(),
  afterJson: text("after_json", { mode: "json" }).$type<Record<string, unknown>>(),
  sourceRunId: integer("source_run_id"),
});
