import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import { brands, brandItems, brandItemChanges } from "../../src/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { makeClassifyItemTierHandler } from "../../src/jobs/classify-item-tier";
import { refineWithAi } from "../../src/domain/catalog";
import { AnthropicClient, FirecrawlClient } from "../../src/infrastructure/external";

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

function makeStubFirecrawl() {
  return new FirecrawlClient({
    apiKey: "test",
    fetch: (() => {
      throw new Error("firecrawl should not be called in heuristic-only mode");
    }) as never,
  });
}

function makeStubAnthropic(fixedTier = "flagship") {
  return new AnthropicClient({
    apiKey: "test",
    sdkOverride: {
      messages: {
        create: () =>
          Promise.resolve({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  tier: fixedTier,
                  rationale: "stub override",
                  confidence: 0.9,
                }),
              },
            ],
            usage: { input_tokens: 10, output_tokens: 20 },
          }),
      },
    } as never,
  });
}

describe("classify-item-tier job (heuristic path)", () => {
  let db: ReturnType<typeof makeDb>;
  let brandId: number;

  beforeEach(async () => {
    db = makeDb();
    const [b] = await db
      .insert(brands)
      .values({ slug: "testbrand", name: "Test Brand", primaryUrl: "https://testbrand.com" })
      .returning();
    if (!b) throw new Error("brand insert failed");
    brandId = b.id;
  });

  test("classifies items by price percentile and records change logs", async () => {
    // Insert 7 items with prices across a range.
    const itemData = [
      { name: "Basic Tee", price: 25, url: "https://testbrand.com/basic" },
      { name: "Entry Short", price: 35, url: "https://testbrand.com/entry" },
      { name: "Mid Top", price: 70, url: "https://testbrand.com/mid" },
      { name: "Standard Pant", price: 90, url: "https://testbrand.com/standard" },
      { name: "Performance Tee", price: 110, url: "https://testbrand.com/perf" },
      { name: "Elite Short", price: 150, url: "https://testbrand.com/elite" },
      { name: "Flagship Jacket", price: 200, url: "https://testbrand.com/flagship" },
    ];

    for (const item of itemData) {
      await db.insert(brandItems).values({
        brandId,
        sourceUrl: item.url,
        name: item.name,
        category: "tops",
        basePriceUsd: item.price,
      });
    }

    const handler = makeClassifyItemTierHandler({
      db,
      firecrawl: makeStubFirecrawl(),
      anthropic: makeStubAnthropic(),
      recordUsage: () => Promise.resolve(),
    });

    await handler({ brandId }, { jobId: 1, heartbeat: () => Promise.resolve() });

    const items = await db.select().from(brandItems);
    // Basic items should be at the bottom percentile (<=25th)
    const basicItem = items.find((i) => i.name === "Basic Tee");
    const flagshipItem = items.find((i) => i.name === "Flagship Jacket");
    const midItem = items.find((i) => i.name === "Mid Top");

    expect(basicItem?.tierClassification).toBe("basic");
    expect(basicItem?.tierInferredBy).toBe("price_percentile");
    expect(flagshipItem?.tierClassification).toBe("flagship");
    expect(flagshipItem?.tierInferredBy).toBe("price_percentile");
    expect(midItem?.tierClassification).toBe("mid");

    // Change logs should be recorded for all 7 items (all changed from 'unclassified').
    const changes = await db.select().from(brandItemChanges);
    expect(changes.length).toBe(7);
    expect(changes.every((c) => c.changeType === "tier_reclassified")).toBe(true);
  });

  test("skips human-classified items", async () => {
    await db.insert(brandItems).values([
      {
        brandId,
        sourceUrl: "https://testbrand.com/a",
        name: "A",
        category: "tops",
        basePriceUsd: 50,
        tierClassification: "flagship",
        tierInferredBy: "human:drew",
      },
      {
        brandId,
        sourceUrl: "https://testbrand.com/b",
        name: "B",
        category: "tops",
        basePriceUsd: 100,
      },
      {
        brandId,
        sourceUrl: "https://testbrand.com/c",
        name: "C",
        category: "tops",
        basePriceUsd: 150,
      },
      {
        brandId,
        sourceUrl: "https://testbrand.com/d",
        name: "D",
        category: "tops",
        basePriceUsd: 200,
      },
    ]);

    const handler = makeClassifyItemTierHandler({
      db,
      firecrawl: makeStubFirecrawl(),
      anthropic: makeStubAnthropic(),
      recordUsage: () => Promise.resolve(),
    });

    await handler({ brandId }, { jobId: 1, heartbeat: () => Promise.resolve() });

    const humanItem = await db
      .select()
      .from(brandItems)
      .where(eq(brandItems.sourceUrl, "https://testbrand.com/a"))
      .limit(1);
    // Human-classified item must NOT be touched.
    expect(humanItem[0]?.tierClassification).toBe("flagship");
    expect(humanItem[0]?.tierInferredBy).toBe("human:drew");

    // Only the 3 non-human items should have change logs.
    const changes = await db.select().from(brandItemChanges);
    expect(changes.length).toBe(3);
  });

  test("does not double-insert change log when re-run with same result", async () => {
    await db.insert(brandItems).values([
      {
        brandId,
        sourceUrl: "https://testbrand.com/a",
        name: "A",
        category: "tops",
        basePriceUsd: 50,
      },
      {
        brandId,
        sourceUrl: "https://testbrand.com/b",
        name: "B",
        category: "tops",
        basePriceUsd: 100,
      },
      {
        brandId,
        sourceUrl: "https://testbrand.com/c",
        name: "C",
        category: "tops",
        basePriceUsd: 150,
      },
      {
        brandId,
        sourceUrl: "https://testbrand.com/d",
        name: "D",
        category: "tops",
        basePriceUsd: 200,
      },
    ]);

    const handler = makeClassifyItemTierHandler({
      db,
      firecrawl: makeStubFirecrawl(),
      anthropic: makeStubAnthropic(),
      recordUsage: () => Promise.resolve(),
    });

    await handler({ brandId }, { jobId: 1, heartbeat: () => Promise.resolve() });
    const changesAfterFirst = await db.select().from(brandItemChanges);
    const countAfterFirst = changesAfterFirst.length;

    // Run again — tiers unchanged, no new change logs.
    await handler({ brandId }, { jobId: 2, heartbeat: () => Promise.resolve() });
    const changesAfterSecond = await db.select().from(brandItemChanges);
    expect(changesAfterSecond.length).toBe(countAfterFirst);
  });
});

describe("refineWithAi (stubbed Anthropic)", () => {
  test("parses AI response into RefineResult", async () => {
    const anthropic = makeStubAnthropic("mid");
    const result = await refineWithAi({
      client: anthropic,
      itemName: "Running Tee",
      itemMarkdown: "Basic polyester tee.",
      basePriceUsd: 45,
      heuristic: { tier: "basic", reason: "price 45 <= basic cap 50" },
    });
    expect(result.tier).toBe("mid");
    expect(result.rationale).toBe("stub override");
    expect(result.confidence).toBe(0.9);
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(20);
  });

  test("uses heuristic when AI returns unclassified", async () => {
    const anthropic = makeStubAnthropic("unclassified");
    const result = await refineWithAi({
      client: anthropic,
      itemName: "Mystery Product",
      itemMarkdown: "",
      basePriceUsd: null,
      heuristic: { tier: "unclassified", reason: "no price" },
    });
    expect(result.tier).toBe("unclassified");
  });
});
