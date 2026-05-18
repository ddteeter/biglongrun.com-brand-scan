import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import { brands, brandItems, brandItemChanges } from "../../src/infrastructure/db/schema";
import { BrandItemService } from "../../src/domain/catalog";
import { eq } from "drizzle-orm";

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
    CREATE TABLE brand_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      external_id TEXT, source_url TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
      tier_classification TEXT NOT NULL DEFAULT 'unclassified',
      tier_inferred_by TEXT, tier_rationale TEXT, base_price_usd REAL,
      per_size_data_json TEXT NOT NULL DEFAULT '{}',
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_discontinued INTEGER NOT NULL DEFAULT 0, discontinued_at TEXT,
      last_etag TEXT, last_modified_header TEXT, last_fetch_hash TEXT, last_fetched_at TEXT,
      UNIQUE(brand_id, source_url)
    );
    CREATE TABLE brand_item_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES brand_items(id) ON DELETE CASCADE,
      changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      change_type TEXT NOT NULL, before_json TEXT, after_json TEXT, source_run_id INTEGER
    );
  `);
  return drizzle(sqlite, { schema });
}

describe("BrandItemService", () => {
  let db: ReturnType<typeof makeDb>;
  let repo: BrandItemService;
  let brandId: number;

  beforeEach(async () => {
    db = makeDb();
    repo = new BrandItemService(db);
    const [b] = await db
      .insert(brands)
      .values({ slug: "x", name: "X", primaryUrl: "https://x.com" })
      .returning();
    if (!b) throw new Error("brand setup failed");
    brandId = b.id;
  });

  test("upsertDraft inserts new item + change log entry", async () => {
    const r = await repo.upsertDraft(
      { brandId, sourceUrl: "https://x.com/p/a", name: "A", category: "tops" },
      null
    );
    expect(r.created).toBe(true);
    const items = await repo.listForBrand(brandId);
    expect(items.length).toBe(1);
    const changes = await db.select().from(brandItemChanges);
    expect(changes.length).toBe(1);
    expect(changes[0]?.changeType).toBe("added");
  });

  test("upsertDraft updates existing item by URL, no new change entry", async () => {
    await repo.upsertDraft(
      { brandId, sourceUrl: "https://x.com/p/a", name: "A", category: "tops" },
      null
    );
    const r2 = await repo.upsertDraft(
      {
        brandId,
        sourceUrl: "https://x.com/p/a",
        name: "A v2",
        category: "tops",
        basePriceUsd: 120,
      },
      null
    );
    expect(r2.created).toBe(false);
    const items = await repo.listForBrand(brandId);
    expect(items.length).toBe(1);
    expect(items[0]?.name).toBe("A v2");
    expect(items[0]?.basePriceUsd).toBe(120);
    const changes = await db.select().from(brandItemChanges);
    expect(changes.length).toBe(1); // still only the original 'added' entry
  });

  test("markDiscontinued sets flag + records change", async () => {
    const r = await repo.upsertDraft(
      { brandId, sourceUrl: "https://x.com/p/a", name: "A", category: "tops" },
      null
    );
    await repo.markDiscontinued(r.id, null);
    const items = await db.select().from(brandItems).where(eq(brandItems.id, r.id));
    expect(items[0]?.isDiscontinued).toBe(true);
    const changes = await db.select().from(brandItemChanges);
    expect(changes.map((c) => c.changeType).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "added",
      "discontinued",
    ]);
  });

  test("listForBrand excludes discontinued by default", async () => {
    const r = await repo.upsertDraft(
      { brandId, sourceUrl: "https://x.com/p/a", name: "A", category: "tops" },
      null
    );
    await repo.markDiscontinued(r.id, null);
    const activeItems = await repo.listForBrand(brandId);
    const allItems = await repo.listForBrand(brandId, { includeDiscontinued: true });
    expect(activeItems.length).toBe(0);
    expect(allItems.length).toBe(1);
  });
});
