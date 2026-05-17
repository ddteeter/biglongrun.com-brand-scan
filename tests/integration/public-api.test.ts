import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import {
  brands,
  brandSizeChartVersions,
  brandScoreSnapshots,
} from "../../src/infrastructure/db/schema";
import { publicApi } from "../../src/public-api";

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
  `);
  return drizzle(sqlite, { schema });
}

const headers = { authorization: "Bearer t" };

describe("public-api routes", () => {
  let db: ReturnType<typeof makeDb>;
  let app: ReturnType<typeof publicApi>;

  beforeEach(() => {
    db = makeDb();
    app = publicApi({ db, bearerToken: "t", bootedAt: new Date() });
  });

  test("/health returns ok without auth", async () => {
    const r = await app.handle(new Request("http://localhost/api/v1/health"));
    expect(r.status).toBe(200);
    const json = (await r.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  test("/brands returns paginated list", async () => {
    await db.insert(brands).values({ slug: "a", name: "A", primaryUrl: "https://a.com" });
    const r = await app.handle(new Request("http://localhost/api/v1/brands", { headers }));
    const json = (await r.json()) as { brands: { slug: string }[] };
    expect(json.brands.length).toBe(1);
    expect(json.brands[0]?.slug).toBe("a");
  });

  test("/brands/:slug returns 404 for missing brand", async () => {
    const r = await app.handle(new Request("http://localhost/api/v1/brands/nope", { headers }));
    expect(r.status).toBe(404);
  });

  test("/brands/:slug/size-chart returns 404 when none accepted", async () => {
    await db.insert(brands).values({ slug: "a", name: "A", primaryUrl: "https://a.com" });
    const r = await app.handle(
      new Request("http://localhost/api/v1/brands/a/size-chart", { headers })
    );
    expect(r.status).toBe(404);
  });

  test("/brands/:slug/size-chart returns accepted chart", async () => {
    const brandRows = await db
      .insert(brands)
      .values({ slug: "a", name: "A", primaryUrl: "https://a.com" })
      .returning();
    const b = brandRows[0];
    if (!b) throw new Error("brand insert failed");
    const chart = { size_labels: ["S"], measurements: { S: {} } };
    const versionRows = await db
      .insert(brandSizeChartVersions)
      .values({
        brandId: b.id,
        brandSourceId: 1,
        sizeChartJson: chart,
        confidenceScore: 0.9,
        confidenceBreakdownJson: { claudeReported: 1, structuralValidation: 1, cohortOutlier: 1 },
        status: "accepted",
      })
      .returning();
    const v = versionRows[0];
    if (!v) throw new Error("version insert failed");
    await db.update(brands).set({ currentSizeChartVersionId: v.id });
    const r = await app.handle(
      new Request("http://localhost/api/v1/brands/a/size-chart", { headers })
    );
    expect(r.status).toBe(200);
    const json = (await r.json()) as { size_labels: string[] };
    expect(json.size_labels).toEqual(["S"]);
  });

  test("/brands/:slug/score-history filters by is_public", async () => {
    const brandRows = await db
      .insert(brands)
      .values({ slug: "a", name: "A", primaryUrl: "https://a.com" })
      .returning();
    const b = brandRows[0];
    if (!b) throw new Error("brand insert failed");
    await db.insert(brandScoreSnapshots).values([
      {
        brandId: b.id,
        promotedFromHistoryId: 1,
        cohortSummaryId: 1,
        scoresJson: { composite: 7 },
        isPublic: true,
      },
      {
        brandId: b.id,
        promotedFromHistoryId: 2,
        cohortSummaryId: 1,
        scoresJson: { composite: 8 },
        isPublic: false,
      },
    ]);
    const r = await app.handle(
      new Request("http://localhost/api/v1/brands/a/score-history", { headers })
    );
    const json = (await r.json()) as { snapshots: unknown[] };
    expect(json.snapshots.length).toBe(1);
  });

  test("ETag returns 304 when If-None-Match matches", async () => {
    await db.insert(brands).values({ slug: "a", name: "A", primaryUrl: "https://a.com" });
    const r1 = await app.handle(new Request("http://localhost/api/v1/brands", { headers }));
    const etag = r1.headers.get("etag");
    expect(etag).not.toBeNull();
    const r2 = await app.handle(
      new Request("http://localhost/api/v1/brands", {
        headers: { ...headers, "if-none-match": etag ?? "" },
      })
    );
    expect(r2.status).toBe(304);
  });
});
