import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import { brands, brandSources } from "../../src/infrastructure/db/schema";
import { runExtraction, type PipelineDeps } from "../../src/domain/extraction/pipeline";
import { FirecrawlClient } from "../../src/infrastructure/external/firecrawl";
import { AnthropicClient } from "../../src/infrastructure/external/anthropic";
import { DomainRateLimiter } from "../../src/infrastructure/external/rate-limiter";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.run(`
    CREATE TABLE brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      primary_url TEXT NOT NULL, category_tag TEXT NOT NULL DEFAULT 'running',
      audience_tags TEXT NOT NULL DEFAULT '[]', current_size_chart_version_id INTEGER,
      divergence_flag INTEGER NOT NULL DEFAULT 0, predicted_next_change_at TEXT,
      cadence_learned_at TEXT, observed_change_intervals TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT
    )
  `);
  sqlite.run(`
    CREATE TABLE brand_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT, brand_id INTEGER NOT NULL,
      url TEXT NOT NULL, source_type TEXT NOT NULL,
      cadence_seconds_override INTEGER, last_etag TEXT, last_modified_header TEXT,
      last_fetch_hash TEXT, last_fetched_at TEXT, last_changed_at TEXT,
      UNIQUE(brand_id, url)
    )
  `);
  sqlite.run(`
    CREATE TABLE brand_size_chart_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, brand_id INTEGER NOT NULL,
      brand_source_id INTEGER NOT NULL, extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
      source_run_id INTEGER, size_chart_json TEXT NOT NULL,
      confidence_score REAL NOT NULL, confidence_breakdown_json TEXT NOT NULL,
      status TEXT NOT NULL, accepted_at TEXT, accepted_by TEXT,
      rejection_reason TEXT, supersedes_version_id INTEGER, delta_from_prior_json TEXT
    )
  `);
  sqlite.run(`
    CREATE TABLE author_brand_assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      author_slug TEXT NOT NULL,
      assessment_date TEXT NOT NULL DEFAULT (date('now')),
      ratings_json TEXT NOT NULL,
      prose_markdown TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL,
      source_review_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return drizzle(sqlite, { schema });
}

const goodMarkdown = `
| Size | Chest | Waist | Hip |
|------|-------|-------|-----|
| S    | 36-38 | 28-30 | 36-38 |
| M    | 38-40 | 30-32 | 38-40 |
| L    | 40-42 | 32-34 | 40-42 |
`;

function urlKey(url: RequestInfo | URL): string {
  if (url instanceof URL) return url.href;
  if (url instanceof Request) return url.url;
  return url;
}

function makeStubFetch(responses: Record<string, Response>): typeof globalThis.fetch {
  return ((url: RequestInfo | URL) => {
    const k = urlKey(url);
    const r = responses[k];
    if (!r) throw new Error(`Unmocked fetch: ${k}`);
    return Promise.resolve(r);
  }) as typeof globalThis.fetch;
}

function makeDeps(db: ReturnType<typeof makeDb>, opts: Partial<PipelineDeps> = {}): PipelineDeps {
  const firecrawl = new FirecrawlClient({
    apiKey: "test",
    fetch: makeStubFetch({
      "https://brand.com/size": new Response(goodMarkdown, {
        status: 200,
        headers: { etag: '"v1"' },
      }),
      "https://api.firecrawl.dev/v1/scrape": Response.json(
        {
          success: true,
          data: { markdown: goodMarkdown, screenshot: "https://files.firecrawl.dev/s.png" },
        },
        { status: 200 }
      ),
      "https://files.firecrawl.dev/s.png": new Response(new Uint8Array([0]), { status: 200 }),
    }),
  });
  const anthropic = new AnthropicClient({
    apiKey: "test",
    sdkOverride: {
      messages: {
        create: () => {
          throw new Error("should not be called in deterministic path");
        },
      },
    } as never,
  });
  const rateLimiter = new DomainRateLimiter({ minIntervalMs: 0 });
  return {
    db,
    firecrawl,
    anthropic,
    rateLimiter,
    cohortSummary: null,
    saveScreenshot: () => Promise.resolve("tmp/x.png"),
    notifyPendingReview: () => Promise.resolve(),
    publicBaseUrl: "http://localhost:3000",
    recordUsage: () => Promise.resolve(),
    ...opts,
  };
}

describe("runExtraction", () => {
  let db: ReturnType<typeof makeDb>;
  let sourceId: number;

  beforeEach(async () => {
    db = makeDb();
    const [b] = await db
      .insert(brands)
      .values({ slug: "x", name: "X", primaryUrl: "https://brand.com" })
      .returning();
    if (!b) throw new Error("brand insert failed");
    const [s] = await db
      .insert(brandSources)
      .values({ brandId: b.id, url: "https://brand.com/size", sourceType: "size_chart" })
      .returning();
    if (!s) throw new Error("brand_source insert failed");
    sourceId = s.id;
  });

  test("auto-accepts a clean deterministic extraction", async () => {
    const r = await runExtraction(makeDeps(db), { brandSourceId: sourceId, runId: 1 });
    expect(r.kind).toBe("auto_accepted");
  });

  test("returns unchanged when ETag matches on second run", async () => {
    await runExtraction(makeDeps(db), { brandSourceId: sourceId, runId: 1 });

    // Second run: configure firecrawl to return 304 when If-None-Match is present
    const secondFetch: typeof globalThis.fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
      if (urlKey(url) === "https://brand.com/size") {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const ifNone = headers["If-None-Match"];
        if (ifNone === '"v1"') return Promise.resolve(new Response(null, { status: 304 }));
      }
      return Promise.resolve(new Response("nope", { status: 500 }));
    }) as typeof globalThis.fetch;

    const second = makeDeps(db, {
      firecrawl: new FirecrawlClient({ apiKey: "test", fetch: secondFetch }),
    });
    const r = await runExtraction(second, { brandSourceId: sourceId, runId: 2 });
    expect(r.kind).toBe("unchanged");
  });
});
