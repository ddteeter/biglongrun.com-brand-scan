import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as schema from "../../src/infrastructure/db/schema";
import { brands, brandSources, brandSizeChartVersions } from "../../src/infrastructure/db/schema";
import { Queue, QueueRunner, clearHandlers } from "../../src/infrastructure/queue";
import { registerJobs } from "../../src/jobs";
import { ArtifactStore } from "../../src/infrastructure/artifacts";
import { FirecrawlClient } from "../../src/infrastructure/external/firecrawl";
import { AnthropicClient } from "../../src/infrastructure/external/anthropic";
import { PushoverClient } from "../../src/infrastructure/external/pushover";
import { DomainRateLimiter } from "../../src/infrastructure/external/rate-limiter";
import { eq } from "drizzle-orm";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.run(
    `CREATE TABLE brands (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      primary_url TEXT NOT NULL, category_tag TEXT NOT NULL DEFAULT 'running',
      audience_tags TEXT NOT NULL DEFAULT '[]', current_size_chart_version_id INTEGER,
      divergence_flag INTEGER NOT NULL DEFAULT 0, predicted_next_change_at TEXT, cadence_learned_at TEXT,
      observed_change_intervals TEXT, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), archived_at TEXT)`
  );
  sqlite.run(
    `CREATE TABLE brand_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, brand_id INTEGER NOT NULL,
      url TEXT NOT NULL, source_type TEXT NOT NULL, cadence_seconds_override INTEGER,
      last_etag TEXT, last_modified_header TEXT, last_fetch_hash TEXT,
      last_fetched_at TEXT, last_changed_at TEXT, UNIQUE(brand_id, url))`
  );
  sqlite.run(
    `CREATE TABLE brand_size_chart_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, brand_id INTEGER NOT NULL,
      brand_source_id INTEGER NOT NULL, extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
      source_run_id INTEGER, size_chart_json TEXT NOT NULL, confidence_score REAL NOT NULL,
      confidence_breakdown_json TEXT NOT NULL, status TEXT NOT NULL, accepted_at TEXT,
      accepted_by TEXT, rejection_reason TEXT, supersedes_version_id INTEGER, delta_from_prior_json TEXT)`
  );
  sqlite.run(
    `CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, job_type TEXT NOT NULL,
      payload_json TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
      scheduled_for TEXT NOT NULL DEFAULT (datetime('now')), picked_at TEXT, heartbeat_at TEXT,
      heartbeat_interval_secs INTEGER, finished_at TEXT, error_json TEXT, run_id INTEGER)`
  );
  sqlite.run(
    `CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT, status TEXT NOT NULL,
      summary_json TEXT, cost_usd_estimate REAL, firecrawl_pages_used INTEGER)`
  );
  sqlite.run(
    `CREATE TABLE run_artifacts (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL,
      kind TEXT NOT NULL, file_path TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`
  );
  sqlite.run(
    `CREATE TABLE api_usage_log (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL,
      run_id INTEGER, units_used REAL NOT NULL, units_kind TEXT NOT NULL,
      estimated_cost_usd REAL NOT NULL, occurred_at TEXT NOT NULL DEFAULT (datetime('now')))`
  );
  sqlite.run(
    `CREATE TABLE author_brand_assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      author_slug TEXT NOT NULL,
      assessment_date TEXT NOT NULL DEFAULT (date('now')),
      ratings_json TEXT NOT NULL,
      prose_markdown TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );
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

describe("extract-brand-source job end-to-end", () => {
  let runner: QueueRunner;
  let tmpDir: string;

  beforeEach(() => {
    clearHandlers();
    tmpDir = mkdtempSync(path.join(tmpdir(), "brand-scan-"));
  });

  afterEach(() => {
    runner.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("runs the pipeline and creates an accepted version row", async () => {
    const db = makeDb();
    const queue = new Queue(db);
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

    const stubFetch: typeof globalThis.fetch = ((url: RequestInfo | URL) => {
      const k = urlKey(url);
      if (k === "https://brand.com/size") {
        return Promise.resolve(
          new Response(goodMarkdown, { status: 200, headers: { etag: '"v1"' } })
        );
      }
      if (k === "https://api.firecrawl.dev/v1/scrape") {
        return Promise.resolve(
          Response.json(
            {
              success: true,
              data: { markdown: goodMarkdown, screenshot: "https://files.firecrawl.dev/s.png" },
            },
            { status: 200 }
          )
        );
      }
      if (k === "https://files.firecrawl.dev/s.png") {
        return Promise.resolve(new Response(new Uint8Array([0]), { status: 200 }));
      }
      throw new Error(`Unmocked fetch: ${k}`);
    }) as typeof globalThis.fetch;

    const firecrawl = new FirecrawlClient({ apiKey: "test", fetch: stubFetch });
    const anthropic = new AnthropicClient({
      apiKey: "test",
      sdkOverride: {
        messages: {
          create: () => {
            throw new Error("not called");
          },
        },
      } as never,
    });
    const pushover = new PushoverClient({
      userKey: "u",
      appToken: "t",
      fetch: (() => Promise.resolve(new Response("{}", { status: 200 }))) as never,
    });
    const artifactStore = new ArtifactStore(tmpDir);
    const rateLimiter = new DomainRateLimiter({ minIntervalMs: 0 });

    registerJobs({
      db,
      queue,
      artifactStore,
      pushover,
      firecrawl,
      anthropic,
      recordUsage: () => Promise.resolve(),
      buildDiscoverDeps: () => ({
        shopify: { tryFetch: () => Promise.resolve(null) } as never,
        sitemap: { discover: () => Promise.resolve([]) } as never,
        firecrawl,
        anthropic,
        rateLimiter,
        recordUsage: () => Promise.resolve(),
      }),
      buildPipelineDeps: () => ({
        db,
        firecrawl,
        anthropic,
        rateLimiter,
        cohortSummary: null,
        saveScreenshot: () => Promise.resolve("x.png"),
        notifyPendingReview: () => Promise.resolve(),
        publicBaseUrl: "http://localhost:3000",
        recordUsage: () => Promise.resolve(),
      }),
      buildIngestDeps: () =>
        ({
          redditClient: { fetchSubreddit: () => Promise.resolve([]) },
          suggestionService: {},
          brandService: {},
          extract: () =>
            Promise.resolve({ candidates: [], usage: { inputTokens: 0, outputTokens: 0 } }),
          recordUsage: () => Promise.resolve(),
        }) as never,
    });

    runner = new QueueRunner({ queue, pollIntervalMs: 50, heartbeatIntervalSecs: 30 });
    runner.start();
    await queue.enqueue({
      jobType: "extract-brand-source",
      payload: { brandSourceId: s.id },
      dedupeKey: "test:1",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const [version] = await db
      .select()
      .from(brandSizeChartVersions)
      .where(eq(brandSizeChartVersions.brandId, b.id));
    expect(version?.status).toBe("accepted");
  });
});
