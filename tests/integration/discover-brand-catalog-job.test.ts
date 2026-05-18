import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import { brands, brandSources, brandItems, runs } from "../../src/infrastructure/db/schema";
import { eq, and } from "drizzle-orm";
import { makeDiscoverBrandCatalogHandler } from "../../src/jobs/discover-brand-catalog";
import { ShopifyCatalogDiscoverer } from "../../src/domain/catalog/shopify";
import { SitemapCatalogDiscoverer } from "../../src/domain/catalog/sitemap";
import { FirecrawlClient } from "../../src/infrastructure/external/firecrawl";
import { AnthropicClient } from "../../src/infrastructure/external/anthropic";
import { DomainRateLimiter } from "../../src/infrastructure/external/rate-limiter";

const SHOPIFY_PRODUCTS = {
  products: [
    {
      id: 1,
      handle: "jacket",
      title: "Storm Jacket",
      product_type: "Outerwear",
      options: [{ name: "Size", values: ["S", "M"] }],
      variants: [
        { id: 1, title: "S", available: true, price: "120.00", option1: "S" },
        { id: 2, title: "M", available: true, price: "120.00", option1: "M" },
      ],
    },
    {
      id: 2,
      handle: "tee",
      title: "Cotton Tee",
      product_type: "Tops",
      options: [{ name: "Size", values: ["S"] }],
      variants: [{ id: 3, title: "S", available: true, price: "40.00", option1: "S" }],
    },
  ],
};

const SHOPIFY_BODY = JSON.stringify(SHOPIFY_PRODUCTS);

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
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT
    );
    CREATE TABLE brand_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      url TEXT NOT NULL, source_type TEXT NOT NULL, cadence_seconds_override INTEGER,
      last_etag TEXT, last_modified_header TEXT, last_fetch_hash TEXT,
      last_fetched_at TEXT, last_changed_at TEXT, UNIQUE(brand_id, url)
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
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_type TEXT NOT NULL,
      payload_json TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
      scheduled_for TEXT NOT NULL DEFAULT (datetime('now')), picked_at TEXT,
      heartbeat_at TEXT, heartbeat_interval_secs INTEGER, finished_at TEXT,
      error_json TEXT, run_id INTEGER
    );
    CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT,
      status TEXT NOT NULL, summary_json TEXT, cost_usd_estimate REAL,
      firecrawl_pages_used INTEGER
    );
  `);
  return drizzle(sqlite, { schema });
}

function urlToString(url: RequestInfo | URL): string {
  if (url instanceof URL) return url.href;
  if (url instanceof Request) return url.url;
  return url;
}

function makeShopifyFetchFn(
  responses: Record<string, { body: string; status?: number; headers?: Record<string, string> }>
) {
  return (url: RequestInfo | URL): Promise<Response> => {
    const key = urlToString(url);
    const r = responses[key];
    if (!r) return Promise.resolve(new Response("", { status: 404 }));
    return Promise.resolve(
      new Response(r.body, {
        status: r.status ?? 200,
        headers: Object.assign({ "content-type": "application/json" }, r.headers),
      })
    );
  };
}

async function insertJobAndBrand(
  db: ReturnType<typeof makeDb>,
  brandPrimaryUrl: string
): Promise<{ brandId: number; jobId: number }> {
  const [brand] = await db
    .insert(brands)
    .values({ slug: "test-brand", name: "Test Brand", primaryUrl: brandPrimaryUrl })
    .returning();
  if (!brand) throw new Error("brand insert failed");

  const [job] = await db
    .insert(schema.jobs)
    .values({
      jobType: "discover_brand_catalog",
      payloadJson: { brandId: brand.id },
      dedupeKey: `test-${String(Date.now())}`,
      status: "running",
    })
    .returning();
  if (!job) throw new Error("job insert failed");

  return { brandId: brand.id, jobId: job.id };
}

describe("makeDiscoverBrandCatalogHandler (Shopify path)", () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
  });

  test("first run: creates BrandSource + upserts items + saves run summary", async () => {
    const { brandId, jobId } = await insertJobAndBrand(db, "https://brand.com");

    const fetchFn = makeShopifyFetchFn({
      "https://brand.com/products.json?page=1&limit=250": {
        body: SHOPIFY_BODY,
        headers: { etag: '"first-etag"', "last-modified": "Tue, 01 Jan 2026 00:00:00 GMT" },
      },
    }) as unknown as typeof globalThis.fetch;

    const handler = makeDiscoverBrandCatalogHandler({
      db,
      buildDiscoverDeps: () => ({
        shopify: new ShopifyCatalogDiscoverer(fetchFn),
        sitemap: new SitemapCatalogDiscoverer(fetchFn),
        firecrawl: new FirecrawlClient({ apiKey: "test", fetch: fetchFn }),
        anthropic: new AnthropicClient({
          apiKey: "test",
          sdkOverride: {
            messages: {
              create: () => {
                throw new Error("should not call anthropic");
              },
            },
          } as never,
        }),
        rateLimiter: new DomainRateLimiter({ minIntervalMs: 0 }),
        recordUsage: () => Promise.resolve(),
      }),
    });

    await handler({ brandId }, { jobId, heartbeat: () => Promise.resolve() });

    // Verify BrandSource was created
    const [source] = await db
      .select()
      .from(brandSources)
      .where(and(eq(brandSources.brandId, brandId), eq(brandSources.sourceType, "shopify_feed")));
    expect(source).toBeDefined();
    expect(source?.lastEtag).toBe('"first-etag"');
    expect(source?.lastFetchedAt).toBeTruthy();

    // Verify items were created
    const items = await db.select().from(brandItems).where(eq(brandItems.brandId, brandId));
    expect(items.length).toBe(2);
    expect(items.some((i) => i.name === "Storm Jacket")).toBe(true);

    // Verify run summary
    const allRuns = await db.select().from(runs);
    if (!allRuns[0]) throw new Error("no run created");
    const run = allRuns[0];
    expect(run.status).toBe("succeeded");
    if (!run.summaryJson) throw new Error("no summaryJson");
    const summary: Record<string, unknown> = run.summaryJson;
    expect(summary.source).toBe("shopify");
    expect(summary.created).toBe(2);
    expect(summary.updated).toBe(0);
  });

  test("second run with same catalog (304 behavior via body hash): unchanged + no item writes", async () => {
    const { brandId, jobId: jobId1 } = await insertJobAndBrand(db, "https://brand.com");
    const { createHash } = await import("node:crypto");
    // The new implementation sorts products by id and hashes the JSON-stringified sorted array
    const sortedProducts = SHOPIFY_PRODUCTS.products.toSorted((a, b) => a.id - b.id);
    const bodyHash = createHash("sha256").update(JSON.stringify(sortedProducts)).digest("hex");

    // Pre-create BrandSource as if first run already completed
    await db.insert(brandSources).values({
      brandId,
      url: "https://brand.com/products.json?page=1&limit=250",
      sourceType: "shopify_feed",
      lastEtag: '"first-etag"',
      lastFetchHash: bodyHash,
      lastFetchedAt: "2026-01-01T00:00:00.000Z",
    });

    // Also pre-create item records
    await db.insert(brandItems).values({
      brandId,
      sourceUrl: "https://brand.com/products/jacket",
      name: "Storm Jacket",
      category: "Outerwear",
      externalId: "jacket",
    });

    const fetchFn = makeShopifyFetchFn({
      // Same body → body hash will match → should return unchanged
      "https://brand.com/products.json?page=1&limit=250": {
        body: SHOPIFY_BODY,
        headers: { etag: '"rotated-etag"' }, // ETag changed but body same
      },
    }) as unknown as typeof globalThis.fetch;

    const handler = makeDiscoverBrandCatalogHandler({
      db,
      buildDiscoverDeps: () => ({
        shopify: new ShopifyCatalogDiscoverer(fetchFn),
        sitemap: new SitemapCatalogDiscoverer(fetchFn),
        firecrawl: new FirecrawlClient({ apiKey: "test", fetch: fetchFn }),
        anthropic: new AnthropicClient({
          apiKey: "test",
          sdkOverride: {
            messages: {
              create: () => {
                throw new Error("should not call anthropic");
              },
            },
          } as never,
        }),
        rateLimiter: new DomainRateLimiter({ minIntervalMs: 0 }),
        recordUsage: () => Promise.resolve(),
      }),
    });

    await handler({ brandId }, { jobId: jobId1, heartbeat: () => Promise.resolve() });

    // Run should show unchanged
    const allRuns = await db.select().from(runs);
    if (!allRuns[0]) throw new Error("no run created");
    const run = allRuns[0];
    expect(run.status).toBe("succeeded");
    if (!run.summaryJson) throw new Error("no summaryJson");
    const summary: Record<string, unknown> = run.summaryJson;
    expect(summary.unchanged).toBe(true);
    expect(summary.created).toBe(0);

    // Brand source lastFetchedAt should be updated (touched)
    const [source] = await db.select().from(brandSources).where(eq(brandSources.brandId, brandId));
    expect(source?.lastFetchedAt).not.toBe("2026-01-01T00:00:00.000Z");

    // Item count should be unchanged (no new items written)
    const items = await db.select().from(brandItems).where(eq(brandItems.brandId, brandId));
    expect(items.length).toBe(1); // still only the pre-seeded item
  });
});
