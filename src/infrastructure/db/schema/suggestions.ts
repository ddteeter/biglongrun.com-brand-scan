import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { brands } from "./brands";

export const brandSuggestions = sqliteTable(
  "brand_suggestions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    suggestedBrandName: text("suggested_brand_name").notNull(),
    suggestedSlug: text("suggested_slug").notNull(),
    suggestedUrl: text("suggested_url"),
    source: text("source", { enum: ["reddit"] }).notNull(),
    sourceSubreddit: text("source_subreddit"),
    sourcePostUrl: text("source_post_url"),
    sourcePostTitle: text("source_post_title"),
    sourceContext: text("source_context"),
    plusSizePriority: integer("plus_size_priority", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["pending", "accepted", "rejected"] })
      .notNull()
      .default("pending"),
    suggestedAt: text("suggested_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    resolvedAt: text("resolved_at"),
    resolvedBrandId: integer("resolved_brand_id").references(() => brands.id, {
      onDelete: "set null",
    }),
    resolutionNote: text("resolution_note"),
    rejectionReason: text("rejection_reason"),
  },
  (t) => [uniqueIndex("brand_suggestions_pending_slug_unique").on(t.suggestedSlug, t.status)]
);
