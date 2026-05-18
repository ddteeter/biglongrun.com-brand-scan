import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import * as schema from "../../src/infrastructure/db/schema";
import { brands } from "../../src/infrastructure/db/schema/brands";
import { brandSizeChartVersions } from "../../src/infrastructure/db/schema/versions";
import { makeComputeBrandCadenceHandler } from "../../src/jobs/compute-brand-cadence";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON;");
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
    CREATE TABLE brand_size_chart_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      brand_source_id INTEGER NOT NULL,
      extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
      source_run_id INTEGER,
      size_chart_json TEXT NOT NULL,
      confidence_score REAL NOT NULL,
      confidence_breakdown_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending_review','accepted','rejected','superseded')),
      accepted_at TEXT,
      accepted_by TEXT,
      rejection_reason TEXT,
      supersedes_version_id INTEGER REFERENCES brand_size_chart_versions(id),
      delta_from_prior_json TEXT
    );
  `);
  return drizzle(sqlite, { schema });
}

const DAY_MS = 86_400_000;
const BASE = new Date("2026-01-01T00:00:00Z").getTime();
function daysOffset(n: number): string {
  return new Date(BASE + n * DAY_MS).toISOString();
}

describe("compute-brand-cadence job", () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
  });

  test("populates predictedNextChangeAt for brand with 4 accepted versions ~30 days apart", async () => {
    const [brand] = await db
      .insert(brands)
      .values({ slug: "tracksmith", name: "Tracksmith", primaryUrl: "https://tracksmith.com" })
      .returning();
    if (!brand) throw new Error("Brand insert failed");

    // Seed 4 accepted versions ~30 days apart
    const acceptedDates = [daysOffset(0), daysOffset(30), daysOffset(60), daysOffset(90)];
    for (const acceptedAt of acceptedDates) {
      await db.insert(brandSizeChartVersions).values({
        brandId: brand.id,
        brandSourceId: 1,
        sizeChartJson: { measurements: {} },
        confidenceScore: 0.9,
        confidenceBreakdownJson: { claudeReported: 0.9, structuralValidation: 1, cohortOutlier: 1 },
        status: "accepted",
        acceptedAt,
      });
    }

    const handler = makeComputeBrandCadenceHandler({ db });
    await handler({}, { jobId: 1, heartbeat: () => Promise.resolve() });

    const [updated] = await db.select().from(brands).where(eq(brands.id, brand.id)).limit(1);

    expect(updated?.predictedNextChangeAt).not.toBeNull();
    expect(updated?.cadenceLearnedAt).not.toBeNull();
    expect(updated?.observedChangeIntervals).toEqual([30, 30, 30]);

    // Verify prediction is roughly 23 days (30 - 7 buffer) after the last accepted date
    const lastAcceptedStr = acceptedDates.at(3);
    const predictedStr = updated?.predictedNextChangeAt;
    if (!lastAcceptedStr || !predictedStr) throw new Error("Missing dates for assertion");
    const lastAccepted = new Date(lastAcceptedStr).getTime();
    const predicted = new Date(predictedStr).getTime();
    const diffDays = (predicted - lastAccepted) / DAY_MS;
    expect(diffDays).toBeCloseTo(23, 0);
  });

  test("brand with fewer than 3 accepted versions gets null predictedNextChangeAt", async () => {
    const [brand] = await db
      .insert(brands)
      .values({ slug: "new-brand", name: "New Brand", primaryUrl: "https://newbrand.com" })
      .returning();
    if (!brand) throw new Error("Brand insert failed");

    // Only 2 accepted versions
    for (const acceptedAt of [daysOffset(0), daysOffset(30)]) {
      await db.insert(brandSizeChartVersions).values({
        brandId: brand.id,
        brandSourceId: 1,
        sizeChartJson: { measurements: {} },
        confidenceScore: 0.8,
        confidenceBreakdownJson: { claudeReported: 0.8, structuralValidation: 1, cohortOutlier: 1 },
        status: "accepted",
        acceptedAt,
      });
    }

    const handler = makeComputeBrandCadenceHandler({ db });
    await handler({}, { jobId: 1, heartbeat: () => Promise.resolve() });

    const [updated] = await db.select().from(brands).where(eq(brands.id, brand.id)).limit(1);

    expect(updated?.predictedNextChangeAt).toBeNull();
    expect(updated?.observedChangeIntervals).toEqual([]);
    expect(updated?.cadenceLearnedAt).not.toBeNull();
  });

  test("inactive brands are skipped", async () => {
    const [brand] = await db
      .insert(brands)
      .values({
        slug: "inactive-brand",
        name: "Inactive Brand",
        primaryUrl: "https://inactive.com",
        active: false,
      })
      .returning();
    if (!brand) throw new Error("Brand insert failed");

    for (const acceptedAt of [daysOffset(0), daysOffset(30), daysOffset(60), daysOffset(90)]) {
      await db.insert(brandSizeChartVersions).values({
        brandId: brand.id,
        brandSourceId: 1,
        sizeChartJson: { measurements: {} },
        confidenceScore: 0.9,
        confidenceBreakdownJson: { claudeReported: 0.9, structuralValidation: 1, cohortOutlier: 1 },
        status: "accepted",
        acceptedAt,
      });
    }

    const handler = makeComputeBrandCadenceHandler({ db });
    await handler({}, { jobId: 1, heartbeat: () => Promise.resolve() });

    const [updated] = await db.select().from(brands).where(eq(brands.id, brand.id)).limit(1);

    // Inactive brand should not be updated
    expect(updated?.cadenceLearnedAt).toBeNull();
  });
});
