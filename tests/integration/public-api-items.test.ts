import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import { brands, brandItems } from "../../src/infrastructure/db/schema";
import { publicApi } from "../../src/public-api";

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
    CREATE TABLE brand_size_chart_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, brand_id INTEGER NOT NULL,
      brand_source_id INTEGER NOT NULL, extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
      source_run_id INTEGER, size_chart_json TEXT NOT NULL, confidence_score REAL NOT NULL,
      confidence_breakdown_json TEXT NOT NULL, status TEXT NOT NULL, accepted_at TEXT,
      accepted_by TEXT, rejection_reason TEXT, supersedes_version_id INTEGER, delta_from_prior_json TEXT);
    CREATE TABLE brand_score_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, brand_id INTEGER NOT NULL,
      snapshot_at TEXT NOT NULL DEFAULT (datetime('now')), promoted_from_history_id INTEGER NOT NULL,
      cohort_summary_id INTEGER NOT NULL, scores_json TEXT NOT NULL, is_public INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, job_type TEXT NOT NULL,
      payload_json TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
      scheduled_for TEXT NOT NULL DEFAULT (datetime('now')), picked_at TEXT, heartbeat_at TEXT,
      heartbeat_interval_secs INTEGER, finished_at TEXT, error_json TEXT, run_id INTEGER);
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
  return drizzle(sqlite, { schema });
}

const headers = { authorization: "Bearer t" };

describe("GET /api/v1/brands/:slug/items", () => {
  let db: ReturnType<typeof makeDb>;
  let app: ReturnType<typeof publicApi>;

  beforeEach(() => {
    db = makeDb();
    app = publicApi({ db, bearerToken: "t", bootedAt: new Date() });
  });

  test("returns 404 problem-details for unknown slug", async () => {
    const r = await app.handle(
      new Request("http://localhost/api/v1/brands/no-such-brand/items", { headers })
    );
    expect(r.status).toBe(404);
    const json = (await r.json()) as { title: string; status: number };
    expect(json.title).toBe("Not Found");
    expect(json.status).toBe(404);
  });

  test("returns empty list for brand with no items", async () => {
    await db
      .insert(brands)
      .values({ slug: "alpha", name: "Alpha", primaryUrl: "https://alpha.com" });
    const r = await app.handle(
      new Request("http://localhost/api/v1/brands/alpha/items", { headers })
    );
    expect(r.status).toBe(200);
    const json = (await r.json()) as { slug: string; count: number; items: unknown[] };
    expect(json.slug).toBe("alpha");
    expect(json.count).toBe(0);
    expect(json.items).toEqual([]);
  });

  test("category filter returns only matching items", async () => {
    const [b] = await db
      .insert(brands)
      .values({ slug: "beta", name: "Beta", primaryUrl: "https://beta.com" })
      .returning();
    if (!b) throw new Error("brand insert failed");
    await db.insert(brandItems).values([
      { brandId: b.id, sourceUrl: "https://beta.com/p/a", name: "Jacket A", category: "outerwear" },
      { brandId: b.id, sourceUrl: "https://beta.com/p/b", name: "Tee B", category: "tops" },
    ]);
    const r = await app.handle(
      new Request("http://localhost/api/v1/brands/beta/items?category=outerwear", { headers })
    );
    const json = (await r.json()) as { count: number; items: { category: string }[] };
    expect(json.count).toBe(1);
    expect(json.items[0]?.category).toBe("outerwear");
  });

  test("excludes discontinued items by default", async () => {
    const [b] = await db
      .insert(brands)
      .values({ slug: "gamma", name: "Gamma", primaryUrl: "https://gamma.com" })
      .returning();
    if (!b) throw new Error("brand insert failed");
    await db.insert(brandItems).values([
      {
        brandId: b.id,
        sourceUrl: "https://gamma.com/p/active",
        name: "Active",
        category: "tops",
        isDiscontinued: false,
      },
      {
        brandId: b.id,
        sourceUrl: "https://gamma.com/p/disco",
        name: "Discontinued",
        category: "tops",
        isDiscontinued: true,
      },
    ]);
    const r = await app.handle(
      new Request("http://localhost/api/v1/brands/gamma/items", { headers })
    );
    const json = (await r.json()) as { count: number; items: { name: string }[] };
    expect(json.count).toBe(1);
    expect(json.items[0]?.name).toBe("Active");
  });

  test("include_discontinued=true returns all items", async () => {
    const [b] = await db
      .insert(brands)
      .values({ slug: "delta", name: "Delta", primaryUrl: "https://delta.com" })
      .returning();
    if (!b) throw new Error("brand insert failed");
    await db.insert(brandItems).values([
      {
        brandId: b.id,
        sourceUrl: "https://delta.com/p/active",
        name: "Active",
        category: "tops",
        isDiscontinued: false,
      },
      {
        brandId: b.id,
        sourceUrl: "https://delta.com/p/disco",
        name: "Gone",
        category: "tops",
        isDiscontinued: true,
      },
    ]);
    const r = await app.handle(
      new Request("http://localhost/api/v1/brands/delta/items?include_discontinued=true", {
        headers,
      })
    );
    const json = (await r.json()) as { count: number };
    expect(json.count).toBe(2);
  });

  test("ETag returns 304 on If-None-Match match", async () => {
    await db
      .insert(brands)
      .values({ slug: "epsilon", name: "Epsilon", primaryUrl: "https://epsilon.com" });
    const r1 = await app.handle(
      new Request("http://localhost/api/v1/brands/epsilon/items", { headers })
    );
    expect(r1.status).toBe(200);
    const etag = r1.headers.get("etag");
    expect(etag).not.toBeNull();
    const r2 = await app.handle(
      new Request("http://localhost/api/v1/brands/epsilon/items", {
        headers: { ...headers, "if-none-match": etag ?? "" },
      })
    );
    expect(r2.status).toBe(304);
  });

  test("response shape includes expected fields", async () => {
    const [b] = await db
      .insert(brands)
      .values({ slug: "zeta", name: "Zeta", primaryUrl: "https://zeta.com" })
      .returning();
    if (!b) throw new Error("brand insert failed");
    await db.insert(brandItems).values({
      brandId: b.id,
      sourceUrl: "https://zeta.com/p/shirt",
      name: "Classic Shirt",
      category: "tops",
      tierClassification: "mid",
      basePriceUsd: 49.99,
    });
    const r = await app.handle(
      new Request("http://localhost/api/v1/brands/zeta/items", { headers })
    );
    const json = (await r.json()) as {
      slug: string;
      count: number;
      items: {
        externalId: string | null;
        sourceUrl: string;
        name: string;
        category: string;
        tier: string;
        basePriceUsd: number;
        perSize: unknown;
        isDiscontinued: boolean;
        firstSeenAt: string;
      }[];
    };
    expect(json.slug).toBe("zeta");
    expect(json.count).toBe(1);
    const item = json.items[0];
    if (!item) throw new Error("expected item");
    expect(item.name).toBe("Classic Shirt");
    expect(item.category).toBe("tops");
    expect(item.tier).toBe("mid");
    expect(item.basePriceUsd).toBe(49.99);
    expect(item.isDiscontinued).toBe(false);
    expect(typeof item.firstSeenAt).toBe("string");
  });
});
