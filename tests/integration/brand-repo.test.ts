import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import { BrandRepo, BrandSourceRepo } from "../../src/domain/brands";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.run(`
    CREATE TABLE brands (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      primary_url TEXT NOT NULL, category_tag TEXT NOT NULL DEFAULT 'running',
      audience_tags TEXT NOT NULL DEFAULT '[]', current_size_chart_version_id INTEGER,
      divergence_flag INTEGER NOT NULL DEFAULT 0, predicted_next_change_at TEXT,
      cadence_learned_at TEXT, observed_change_intervals TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT);
    CREATE TABLE brand_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, brand_id INTEGER NOT NULL,
      url TEXT NOT NULL, source_type TEXT NOT NULL, cadence_seconds_override INTEGER,
      last_etag TEXT, last_modified_header TEXT, last_fetch_hash TEXT,
      last_fetched_at TEXT, last_changed_at TEXT, UNIQUE(brand_id, url));
  `);
  return drizzle(sqlite, { schema });
}

describe("BrandRepo", () => {
  let repo: BrandRepo;
  let sourceRepo: BrandSourceRepo;
  beforeEach(() => {
    const db = makeDb();
    repo = new BrandRepo(db);
    sourceRepo = new BrandSourceRepo(db);
  });

  test("create generates slug from name and avoids collisions", async () => {
    const a = await repo.create({ name: "Path Projects", primaryUrl: "https://pathprojects.com" });
    expect(a.slug).toBe("path-projects");
    const b = await repo.create({ name: "Path Projects", primaryUrl: "https://different.com" });
    expect(b.slug).toBe("path-projects-2");
  });

  test("findBySlug returns row or null", async () => {
    await repo.create({ name: "Tracksmith", primaryUrl: "https://tracksmith.com" });
    const found = await repo.findBySlug("tracksmith");
    expect(found?.name).toBe("Tracksmith");
    expect(await repo.findBySlug("nope")).toBeNull();
  });

  test("BrandSourceRepo create + listForBrand", async () => {
    const b = await repo.create({ name: "X", primaryUrl: "https://x.com" });
    await sourceRepo.create({ brandId: b.id, url: "https://x.com/size", sourceType: "size_chart" });
    const sources = await sourceRepo.listForBrand(b.id);
    expect(sources).toHaveLength(1);
  });
});
