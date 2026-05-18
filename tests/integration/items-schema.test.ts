import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { brands } from "../../src/infrastructure/db/schema/brands";
import { brandItems, brandItemChanges } from "../../src/infrastructure/db/schema/items";

describe("brand_items + brand_item_changes schema", () => {
  let db: ReturnType<typeof drizzle>;
  beforeEach(() => {
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
      CREATE TABLE brand_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        external_id TEXT,
        source_url TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        tier_classification TEXT NOT NULL DEFAULT 'unclassified' CHECK (tier_classification IN ('flagship','mid','basic','unclassified')),
        tier_inferred_by TEXT,
        tier_rationale TEXT,
        base_price_usd REAL,
        per_size_data_json TEXT NOT NULL DEFAULT '{}',
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
        is_discontinued INTEGER NOT NULL DEFAULT 0,
        discontinued_at TEXT,
        last_etag TEXT, last_modified_header TEXT, last_fetch_hash TEXT, last_fetched_at TEXT,
        UNIQUE(brand_id, source_url)
      );
      CREATE TABLE brand_item_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES brand_items(id) ON DELETE CASCADE,
        changed_at TEXT NOT NULL DEFAULT (datetime('now')),
        change_type TEXT NOT NULL CHECK (change_type IN ('size_added','tier_reclassified','discontinued','price_changed','added')),
        before_json TEXT,
        after_json TEXT,
        source_run_id INTEGER
      );
    `);
    db = drizzle(sqlite);
  });

  test("inserts a brand item with default tier", async () => {
    const [b] = await db
      .insert(brands)
      .values({ slug: "x", name: "X", primaryUrl: "https://x.com" })
      .returning();
    if (!b) throw new Error("brand insert returned empty");
    const [item] = await db
      .insert(brandItems)
      .values({
        brandId: b.id,
        sourceUrl: "https://x.com/p/storm-jacket",
        name: "Storm Jacket",
        category: "outerwear",
      })
      .returning();
    expect(item?.tierClassification).toBe("unclassified");
    expect(item?.isDiscontinued).toBe(false);
  });

  test("brand_id+source_url uniqueness", async () => {
    const [b] = await db
      .insert(brands)
      .values({ slug: "x", name: "X", primaryUrl: "https://x.com" })
      .returning();
    if (!b) throw new Error("brand insert returned empty");
    await db.insert(brandItems).values({
      brandId: b.id,
      sourceUrl: "https://x.com/p/a",
      name: "A",
      category: "tops",
    });
    let threw = false;
    try {
      await db.insert(brandItems).values({
        brandId: b.id,
        sourceUrl: "https://x.com/p/a",
        name: "Different",
        category: "tops",
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("brand_item_changes cascade-deletes when item deleted", async () => {
    const [b] = await db
      .insert(brands)
      .values({ slug: "x", name: "X", primaryUrl: "https://x.com" })
      .returning();
    if (!b) throw new Error("brand insert returned empty");
    const [item] = await db
      .insert(brandItems)
      .values({
        brandId: b.id,
        sourceUrl: "https://x.com/p/a",
        name: "A",
        category: "tops",
      })
      .returning();
    if (!item) throw new Error("item insert returned empty");
    await db.insert(brandItemChanges).values({
      itemId: item.id,
      changeType: "added",
      afterJson: { name: "A" },
    });
    await db.delete(brandItems).where(eq(brandItems.id, item.id));
    const remaining = await db.select().from(brandItemChanges);
    expect(remaining.length).toBe(0);
  });
});
