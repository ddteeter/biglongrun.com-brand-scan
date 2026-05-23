import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import * as schema from "../../src/infrastructure/db/schema";
import { brands, brandSuggestions, jobs, runs } from "../../src/infrastructure/db/schema";
import { clearHandlers } from "../../src/infrastructure/queue";
import {
  BrandSuggestionService,
  RedditRssClient,
  type RedditPost,
  type ExtractResult,
} from "../../src/domain/suggestions";
import { BrandService } from "../../src/domain/brands";
import { makeIngestSubredditHandler } from "../../src/jobs/ingest-subreddit";

function makeDb(): ReturnType<typeof drizzle<typeof schema>> {
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
      suggested_brand_name TEXT NOT NULL, suggested_slug TEXT NOT NULL, suggested_url TEXT,
      source TEXT NOT NULL, source_subreddit TEXT, source_post_url TEXT, source_post_title TEXT,
      source_context TEXT,
      plus_size_priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      suggested_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT, resolved_brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
      resolution_note TEXT, rejection_reason TEXT,
      UNIQUE(suggested_slug, status)
    );
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_type TEXT NOT NULL,
      payload_json TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
      scheduled_for TEXT NOT NULL DEFAULT (datetime('now')), picked_at TEXT, heartbeat_at TEXT,
      heartbeat_interval_secs INTEGER, finished_at TEXT, error_json TEXT, run_id INTEGER
    );
    CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT, status TEXT NOT NULL,
      summary_json TEXT, cost_usd_estimate REAL, firecrawl_pages_used INTEGER
    );
  `);
  return drizzle(sqlite, { schema });
}

const POST_A: RedditPost = {
  id: "t3_a",
  subreddit: "AdvancedRunning",
  title: "Best running tops?",
  selftext: "Love my Tracksmith.",
  url: "https://reddit.com/post/a",
  publishedAt: "2026-05-01T12:00:00Z",
};

const POST_B: RedditPost = {
  id: "t3_b",
  subreddit: "AdvancedRunning",
  title: "Cheap gear?",
  selftext: "Path Projects shorts are great.",
  url: "https://reddit.com/post/b",
  publishedAt: "2026-05-02T12:00:00Z",
};

class StubReddit extends RedditRssClient {
  private readonly posts: RedditPost[];
  constructor(posts: RedditPost[]) {
    super();
    this.posts = posts;
  }
  override fetchSubreddit(): Promise<RedditPost[]> {
    return Promise.resolve(this.posts);
  }
}

interface ExtractCall {
  count: number;
}

function makeExtract(responses: ExtractResult[]): (post: RedditPost) => Promise<ExtractResult> {
  const tracker: ExtractCall = { count: 0 };
  return () => {
    const idx = tracker.count;
    tracker.count++;
    return Promise.resolve(
      responses[idx] ?? { candidates: [], usage: { inputTokens: 0, outputTokens: 0 } }
    );
  };
}

async function seedJob(db: ReturnType<typeof makeDb>, dedupeKey: string): Promise<number> {
  const [job] = await db
    .insert(jobs)
    .values({
      jobType: "ingest-subreddit",
      payloadJson: { subreddit: "AdvancedRunning" },
      dedupeKey,
      status: "running",
    })
    .returning();
  if (!job) throw new Error("job seed failed");
  return job.id;
}

describe("ingest-subreddit handler", () => {
  beforeEach(() => {
    clearHandlers();
  });

  test("creates suggestions for new brands, skips existing, records run summary", async () => {
    const db = makeDb();
    // Seed an existing brand to exercise the skipExisting path.
    await db
      .insert(brands)
      .values({ slug: "tracksmith", name: "Tracksmith", primaryUrl: "https://tracksmith.com" });
    const jobId = await seedJob(db, "test-1");

    const usageCalls: number[] = [];
    const handler = makeIngestSubredditHandler({
      db,
      buildIngestDeps: () => ({
        redditClient: new StubReddit([POST_A, POST_B]),
        suggestionService: new BrandSuggestionService(db),
        brandService: new BrandService(db),
        extract: makeExtract([
          {
            candidates: [
              {
                brandName: "Tracksmith",
                contextExcerpt: "Love my Tracksmith.",
                plusSizeSignal: false,
              },
            ],
            usage: { inputTokens: 100, outputTokens: 50 },
          },
          {
            candidates: [
              {
                brandName: "Path Projects",
                contextExcerpt: "Path Projects shorts are great.",
                plusSizeSignal: false,
              },
            ],
            usage: { inputTokens: 120, outputTokens: 40 },
          },
        ]),
        recordUsage: (input) => {
          usageCalls.push(input.unitsUsed);
          return Promise.resolve();
        },
      }),
    });

    await handler({ subreddit: "AdvancedRunning" }, { jobId, heartbeat: () => Promise.resolve() });

    const suggestions = await db.select().from(brandSuggestions);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0]?.suggestedSlug).toBe("path-projects");

    const runRows = await db.select().from(runs).where(eq(runs.jobId, jobId));
    expect(runRows[0]?.status).toBe("succeeded");
    const summary = runRows[0]?.summaryJson as {
      subreddit: string;
      suggestionsCreated: number;
      suggestionsSkippedExisting: number;
      candidatesProposed: number;
    };
    expect(summary.subreddit).toBe("AdvancedRunning");
    expect(summary.suggestionsCreated).toBe(1);
    expect(summary.suggestionsSkippedExisting).toBe(1);
    expect(summary.candidatesProposed).toBe(2);

    // recordUsage called once per post
    expect(usageCalls).toEqual([150, 160]);
  });

  test("plus_size_signal=true sets plus_size_priority=true on suggestion", async () => {
    const db = makeDb();
    const jobId = await seedJob(db, "test-2");

    const handler = makeIngestSubredditHandler({
      db,
      buildIngestDeps: () => ({
        redditClient: new StubReddit([POST_A]),
        suggestionService: new BrandSuggestionService(db),
        brandService: new BrandService(db),
        extract: makeExtract([
          {
            candidates: [
              {
                brandName: "Senita Athletics",
                contextExcerpt: "Senita has plus-size options.",
                plusSizeSignal: true,
              },
            ],
            usage: { inputTokens: 100, outputTokens: 50 },
          },
        ]),
        recordUsage: () => Promise.resolve(),
      }),
    });

    await handler({ subreddit: "PlusSizeFitness" }, { jobId, heartbeat: () => Promise.resolve() });

    const suggestions = await db.select().from(brandSuggestions);
    expect(suggestions[0]?.plusSizePriority).toBe(true);
  });

  test("duplicate pending suggestion is counted as skipped (not created)", async () => {
    const db = makeDb();
    // Pre-seed a pending suggestion for the same slug so the second insert is a no-op.
    await db.insert(brandSuggestions).values({
      suggestedBrandName: "Senita Athletics",
      suggestedSlug: "senita-athletics",
      source: "reddit",
      sourceSubreddit: "PlusSizeFitness",
      sourcePostUrl: "https://reddit.com/post/prior",
      sourcePostTitle: "earlier mention",
      plusSizePriority: true,
      status: "pending",
    });
    const jobId = await seedJob(db, "test-3");

    const handler = makeIngestSubredditHandler({
      db,
      buildIngestDeps: () => ({
        redditClient: new StubReddit([POST_A]),
        suggestionService: new BrandSuggestionService(db),
        brandService: new BrandService(db),
        extract: makeExtract([
          {
            candidates: [
              {
                brandName: "Senita Athletics",
                contextExcerpt: "Senita again",
                plusSizeSignal: false,
              },
            ],
            usage: { inputTokens: 100, outputTokens: 50 },
          },
        ]),
        recordUsage: () => Promise.resolve(),
      }),
    });

    await handler({ subreddit: "PlusSizeFitness" }, { jobId, heartbeat: () => Promise.resolve() });

    const runRows = await db.select().from(runs).where(eq(runs.jobId, jobId));
    const summary = runRows[0]?.summaryJson as {
      suggestionsCreated: number;
      suggestionsSkippedDuplicate: number;
    };
    expect(summary.suggestionsCreated).toBe(0);
    expect(summary.suggestionsSkippedDuplicate).toBe(1);
  });

  test("failed extraction marks run as failed and re-throws", async () => {
    const db = makeDb();
    const jobId = await seedJob(db, "test-4");

    const handler = makeIngestSubredditHandler({
      db,
      buildIngestDeps: () => ({
        redditClient: new StubReddit([POST_A]),
        suggestionService: new BrandSuggestionService(db),
        brandService: new BrandService(db),
        extract: () => Promise.reject(new Error("model failure")),
        recordUsage: () => Promise.resolve(),
      }),
    });

    let threw = false;
    try {
      await handler({ subreddit: "running" }, { jobId, heartbeat: () => Promise.resolve() });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const runRows = await db.select().from(runs).where(eq(runs.jobId, jobId));
    expect(runRows[0]?.status).toBe("failed");
    const summary = runRows[0]?.summaryJson as { error: string };
    expect(summary.error).toBe("model failure");
  });
});
