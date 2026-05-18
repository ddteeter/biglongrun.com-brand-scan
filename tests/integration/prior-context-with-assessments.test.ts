import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import {
  brands,
  authorBrandAssessments,
  brandSizeChartVersions,
} from "../../src/infrastructure/db/schema";
import { assemblePriorContext } from "../../src/domain/extraction/prior-context";

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
    );
    CREATE TABLE brand_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT, brand_id INTEGER NOT NULL,
      url TEXT NOT NULL, source_type TEXT NOT NULL, cadence_seconds_override INTEGER,
      last_etag TEXT, last_modified_header TEXT, last_fetch_hash TEXT,
      last_fetched_at TEXT, last_changed_at TEXT, UNIQUE(brand_id, url)
    );
    CREATE TABLE brand_size_chart_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, brand_id INTEGER NOT NULL,
      brand_source_id INTEGER NOT NULL, extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
      source_run_id INTEGER, size_chart_json TEXT NOT NULL, confidence_score REAL NOT NULL,
      confidence_breakdown_json TEXT NOT NULL, status TEXT NOT NULL, accepted_at TEXT,
      accepted_by TEXT, rejection_reason TEXT, supersedes_version_id INTEGER, delta_from_prior_json TEXT
    );
  `);
  return drizzle(sqlite, { schema });
}

const goodRatings = {
  size_options: 7,
  tier_equity: 5,
  pricing_equity: 8,
  fit_label_honesty: 6,
  overall_inclusivity: 6.5,
};

const minimalChart = {
  source_url: "https://example.com/size-chart",
  extracted_at: "2026-01-01T00:00:00.000Z",
  method: "claude",
  size_labels: ["S", "M", "L"],
  measurements: {
    S: { chest_in: [34, 36], waist_in: [28, 30], hip_in: [36, 38] },
    M: { chest_in: [36, 38], waist_in: [30, 32], hip_in: [38, 40] },
    L: { chest_in: [38, 40], waist_in: [32, 34], hip_in: [40, 42] },
  },
  size_availability: [],
  notes: "",
  gender_specific: false,
};

describe("assemblePriorContext with assessments", () => {
  let db: ReturnType<typeof makeDb>;
  let brandId: number;

  beforeEach(async () => {
    db = makeDb();
    const [b] = await db
      .insert(brands)
      .values({ slug: "test-brand", name: "Test Brand", primaryUrl: "https://test.com" })
      .returning();
    if (!b) throw new Error("brand setup");
    brandId = b.id;
  });

  test("returns empty assessments array when no assessments exist", async () => {
    const ctx = await assemblePriorContext(db, brandId);
    expect(ctx.assessments).toEqual([]);
    expect(ctx.corrections).toEqual([]);
    expect(ctx.lastAccepted).toBeNull();
  });

  test("returns populated assessments ordered by date desc", async () => {
    await db.insert(authorBrandAssessments).values([
      {
        brandId,
        authorSlug: "alice",
        assessmentDate: "2026-01-15",
        ratingsJson: goodRatings,
        proseMarkdown: "Older assessment.",
        origin: "native",
      },
      {
        brandId,
        authorSlug: "drew",
        assessmentDate: "2026-05-01",
        ratingsJson: { ...goodRatings, overall_inclusivity: 8 },
        proseMarkdown: "Newer assessment.",
        origin: "native",
      },
    ]);

    const ctx = await assemblePriorContext(db, brandId);
    expect(ctx.assessments.length).toBe(2);
    // Most recent first
    expect(ctx.assessments[0]?.authorSlug).toBe("drew");
    expect(ctx.assessments[0]?.assessmentDate).toBe("2026-05-01");
    expect(ctx.assessments[1]?.authorSlug).toBe("alice");
    expect(ctx.assessments[1]?.assessmentDate).toBe("2026-01-15");
  });

  test("assessments shape includes authorSlug, assessmentDate, ratings, proseMarkdown", async () => {
    await db.insert(authorBrandAssessments).values({
      brandId,
      authorSlug: "drew",
      assessmentDate: "2026-05-16",
      ratingsJson: goodRatings,
      proseMarkdown: "Great size options.",
      origin: "native",
    });

    const ctx = await assemblePriorContext(db, brandId);
    const a = ctx.assessments[0];
    expect(a?.authorSlug).toBe("drew");
    expect(a?.assessmentDate).toBe("2026-05-16");
    expect(a?.proseMarkdown).toBe("Great size options.");
    expect(a?.ratings).toMatchObject({ overall_inclusivity: 6.5, size_options: 7 });
  });

  test("caps assessments at 5 most recent", async () => {
    const dates = [
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
    ];
    for (const assessmentDate of dates) {
      await db.insert(authorBrandAssessments).values({
        brandId,
        authorSlug: "drew",
        assessmentDate,
        ratingsJson: goodRatings,
        origin: "native",
      });
    }

    const ctx = await assemblePriorContext(db, brandId);
    expect(ctx.assessments.length).toBe(5);
    // Should be 5 most recent
    expect(ctx.assessments[0]?.assessmentDate).toBe("2026-06-01");
  });

  test("returns lastAccepted chart when an accepted version exists", async () => {
    // insert a brand_source first
    const [src] = await db
      .insert(schema.brandSources)
      .values({ brandId, url: "https://test.com/size-chart", sourceType: "size_chart" })
      .returning();
    if (!src) throw new Error("source setup");

    await db.insert(brandSizeChartVersions).values({
      brandId,
      brandSourceId: src.id,
      sizeChartJson: minimalChart,
      confidenceScore: 0.9,
      confidenceBreakdownJson: { claudeReported: 0.9, structuralValidation: 1, cohortOutlier: 0.9 },
      status: "accepted",
    });

    const ctx = await assemblePriorContext(db, brandId);
    expect(ctx.lastAccepted).not.toBeNull();
    expect(ctx.lastAccepted?.size_labels).toEqual(["S", "M", "L"]);
  });

  test("does not return assessments from other brands", async () => {
    const [other] = await db
      .insert(brands)
      .values({ slug: "other-brand", name: "Other", primaryUrl: "https://other.com" })
      .returning();
    if (!other) throw new Error("other brand setup");

    await db.insert(authorBrandAssessments).values({
      brandId: other.id,
      authorSlug: "drew",
      assessmentDate: "2026-05-16",
      ratingsJson: goodRatings,
      origin: "native",
    });

    const ctx = await assemblePriorContext(db, brandId);
    expect(ctx.assessments.length).toBe(0);
  });
});
