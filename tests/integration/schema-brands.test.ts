import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { brands, brandSources } from "../../src/infrastructure/db/schema/brands";

describe("brands + brand_sources schema", () => {
  let db: ReturnType<typeof drizzle>;
  let sqlite: Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.run("PRAGMA foreign_keys = ON;");
    db = drizzle(sqlite);
    sqlite.run(`
      CREATE TABLE brands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        primary_url TEXT NOT NULL,
        category_tag TEXT NOT NULL DEFAULT 'running',
        audience_tags TEXT NOT NULL DEFAULT '[]',
        current_size_chart_version_id INTEGER,
        divergence_flag INTEGER NOT NULL DEFAULT 0,
        predicted_next_change_at TEXT,
        cadence_learned_at TEXT,
        observed_change_intervals TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );
      CREATE TABLE brand_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('size_chart','catalog_root','shopify_feed')),
        cadence_seconds_override INTEGER,
        last_etag TEXT,
        last_modified_header TEXT,
        last_fetch_hash TEXT,
        last_fetched_at TEXT,
        last_changed_at TEXT,
        UNIQUE(brand_id, url)
      );
    `);
  });

  test("inserts a brand", () => {
    const rows = db
      .insert(brands)
      .values({
        slug: "tracksmith",
        name: "Tracksmith",
        primaryUrl: "https://tracksmith.com",
      })
      .returning()
      .all();
    const row = rows[0];
    expect(row?.slug).toBe("tracksmith");
    expect(row?.active).toBe(true);
  });

  test("enforces unique slug", () => {
    db.insert(brands)
      .values({
        slug: "tracksmith",
        name: "Tracksmith",
        primaryUrl: "https://tracksmith.com",
      })
      .run();
    expect(() => {
      db.insert(brands)
        .values({
          slug: "tracksmith",
          name: "Other",
          primaryUrl: "https://other.com",
        })
        .run();
    }).toThrow();
  });

  test("cascade-deletes sources when brand deleted", () => {
    const inserted = db
      .insert(brands)
      .values({
        slug: "x",
        name: "X",
        primaryUrl: "https://x.com",
      })
      .returning()
      .all();
    const b = inserted[0];
    if (!b) throw new Error("Brand insert failed");
    db.insert(brandSources)
      .values({
        brandId: b.id,
        url: "https://x.com/size-chart",
        sourceType: "size_chart",
      })
      .run();
    db.delete(brands).where(eq(brands.id, b.id)).run();
    const sources = db.select().from(brandSources).all();
    expect(sources.length).toBe(0);
  });
});
