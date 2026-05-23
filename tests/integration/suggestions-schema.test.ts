import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { brands } from "../../src/infrastructure/db/schema/brands";
import { brandSuggestions } from "../../src/infrastructure/db/schema/suggestions";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON;");
  sqlite.run(`
    CREATE TABLE brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      primary_url TEXT NOT NULL, category_tag TEXT NOT NULL DEFAULT 'running',
      audience_tags TEXT NOT NULL DEFAULT '[]', current_size_chart_version_id INTEGER,
      divergence_flag INTEGER NOT NULL DEFAULT 0, predicted_next_change_at TEXT,
      cadence_learned_at TEXT, observed_change_intervals TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT
    );
    CREATE TABLE brand_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      suggested_brand_name TEXT NOT NULL,
      suggested_slug TEXT NOT NULL,
      suggested_url TEXT,
      source TEXT NOT NULL,
      source_subreddit TEXT,
      source_post_url TEXT,
      source_post_title TEXT,
      source_context TEXT,
      plus_size_priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      suggested_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      resolved_brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
      resolution_note TEXT,
      rejection_reason TEXT
    );
    CREATE UNIQUE INDEX brand_suggestions_pending_slug_unique ON brand_suggestions(suggested_slug, status);
  `);
  return drizzle(sqlite);
}

describe("brand_suggestions schema", () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
  });

  test("inserts a pending suggestion with correct defaults", async () => {
    const [row] = await db
      .insert(brandSuggestions)
      .values({
        suggestedBrandName: "Path Projects",
        suggestedSlug: "path-projects",
        source: "reddit",
        sourceSubreddit: "running",
        sourcePostUrl: "https://reddit.com/r/running/123",
        sourcePostTitle: "Best running brands?",
      })
      .returning();

    expect(row).toBeDefined();
    expect(row?.suggestedBrandName).toBe("Path Projects");
    expect(row?.status).toBe("pending");
    expect(row?.plusSizePriority).toBe(false);
    expect(row?.suggestedAt).toBeTruthy();
    expect(row?.resolvedBrandId).toBeNull();
  });

  test("inserting a second pending suggestion with the same slug fails (UNIQUE constraint)", async () => {
    await db.insert(brandSuggestions).values({
      suggestedBrandName: "Path Projects",
      suggestedSlug: "path-projects",
      source: "reddit",
      sourcePostUrl: "https://reddit.com/r/running/123",
      sourcePostTitle: "Best running brands?",
    });

    let threw = false;
    try {
      await db.insert(brandSuggestions).values({
        suggestedBrandName: "Path Projects",
        suggestedSlug: "path-projects",
        source: "reddit",
        sourcePostUrl: "https://reddit.com/r/running/456",
        sourcePostTitle: "More gear talk",
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("inserting a suggestion with same slug but status='rejected' succeeds (history allowed)", async () => {
    await db.insert(brandSuggestions).values({
      suggestedBrandName: "Path Projects",
      suggestedSlug: "path-projects",
      source: "reddit",
      status: "rejected",
      sourcePostUrl: "https://reddit.com/r/running/123",
      sourcePostTitle: "Best running brands?",
    });

    const [second] = await db
      .insert(brandSuggestions)
      .values({
        suggestedBrandName: "Path Projects",
        suggestedSlug: "path-projects",
        source: "reddit",
        status: "pending",
        sourcePostUrl: "https://reddit.com/r/running/456",
        sourcePostTitle: "More gear talk",
      })
      .returning();

    expect(second?.suggestedSlug).toBe("path-projects");
    expect(second?.status).toBe("pending");
  });

  test("deleting a referenced brand sets resolved_brand_id to NULL on accepted suggestions", async () => {
    const [brand] = await db
      .insert(brands)
      .values({
        slug: "path-projects",
        name: "Path Projects",
        primaryUrl: "https://path-projects.com",
      })
      .returning();
    if (!brand) throw new Error("brand setup failed");

    const [suggestion] = await db
      .insert(brandSuggestions)
      .values({
        suggestedBrandName: "Path Projects",
        suggestedSlug: "path-projects",
        source: "reddit",
        status: "accepted",
        sourcePostUrl: "https://reddit.com/r/running/123",
        sourcePostTitle: "Best running brands?",
        resolvedBrandId: brand.id,
      })
      .returning();
    if (!suggestion) throw new Error("suggestion setup failed");

    await db.delete(brands).where(eq(brands.id, brand.id));

    const [updated] = await db
      .select()
      .from(brandSuggestions)
      .where(eq(brandSuggestions.id, suggestion.id));

    expect(updated?.resolvedBrandId).toBeNull();
  });
});
