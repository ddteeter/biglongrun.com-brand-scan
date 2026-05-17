import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import * as schema from "../../src/infrastructure/db/schema";
import {
  brands,
  brandSizeChartVersions,
  cohortSummaries,
  brandItems,
  brandScoreHistory,
} from "../../src/infrastructure/db/schema";
import { makeScoreBrandHandler } from "../../src/jobs/score-brand";
import type { HandlerContext } from "../../src/infrastructure/queue/handlers";

function makeDb() {
  const sqlite = new Database(":memory:");
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
      brand_id INTEGER NOT NULL,
      brand_source_id INTEGER NOT NULL,
      extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
      source_run_id INTEGER,
      size_chart_json TEXT NOT NULL,
      confidence_score REAL NOT NULL,
      confidence_breakdown_json TEXT NOT NULL,
      status TEXT NOT NULL,
      accepted_at TEXT,
      accepted_by TEXT,
      rejection_reason TEXT,
      supersedes_version_id INTEGER,
      delta_from_prior_json TEXT
    );
    CREATE TABLE cohort_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      scoring_config_version TEXT NOT NULL,
      brand_count INTEGER NOT NULL,
      summary_json TEXT NOT NULL,
      trigger TEXT NOT NULL
    );
    CREATE TABLE brand_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER NOT NULL,
      external_id TEXT,
      source_url TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      tier_classification TEXT NOT NULL DEFAULT 'unclassified',
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
    CREATE TABLE brand_score_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER NOT NULL,
      computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      scoring_config_version TEXT NOT NULL,
      cohort_summary_id INTEGER NOT NULL,
      scores_json TEXT NOT NULL,
      inputs_json TEXT NOT NULL
    );
    CREATE TABLE brand_score_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER NOT NULL,
      snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
      promoted_from_history_id INTEGER NOT NULL,
      cohort_summary_id INTEGER NOT NULL,
      scores_json TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 0
    );
  `);
  return drizzle(sqlite, { schema });
}

async function noopHeartbeat(): Promise<void> {
  // intentional no-op for test context
}

const mockCtx: HandlerContext = { jobId: 1, heartbeat: noopHeartbeat };

const sizeChart = {
  source_url: "https://example.com/size-chart",
  extracted_at: new Date().toISOString(),
  method: "claude",
  size_labels: ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
  measurements: {
    XS: { chest_in: [32, 34], waist_in: [24, 26], hip_in: [32, 34] },
    S: { chest_in: [34, 36], waist_in: [26, 28], hip_in: [34, 36] },
    M: { chest_in: [36, 38], waist_in: [28, 30], hip_in: [36, 38] },
    L: { chest_in: [38, 40], waist_in: [30, 32], hip_in: [38, 40] },
    XL: { chest_in: [40, 42], waist_in: [32, 34], hip_in: [40, 42] },
    "2XL": { chest_in: [42, 44], waist_in: [34, 36], hip_in: [42, 44] },
    "3XL": { chest_in: [44, 46], waist_in: [36, 38], hip_in: [44, 46] },
  },
  size_availability: [],
  notes: "",
  gender_specific: false,
};

const cohortSummaryData = {
  perSize: {
    S: {
      chestMedian: 35,
      waistMedian: 27,
      hipMedian: 35,
      chestStdDev: 1,
      waistStdDev: 1,
      hipStdDev: 1,
    },
    M: {
      chestMedian: 37,
      waistMedian: 29,
      hipMedian: 37,
      chestStdDev: 1,
      waistStdDev: 1,
      hipStdDev: 1,
    },
    L: {
      chestMedian: 39,
      waistMedian: 31,
      hipMedian: 39,
      chestStdDev: 1,
      waistStdDev: 1,
      hipStdDev: 1,
    },
  },
  breadths: [5, 6, 7, 7, 7],
  breadthMedian: 7,
  breadthMin: 5,
  breadthMax: 7,
};

async function seedBrand(db: ReturnType<typeof makeDb>) {
  const [brand] = await db
    .insert(brands)
    .values({ slug: "test-brand", name: "Test Brand", primaryUrl: "https://test.com" })
    .returning();
  if (!brand) throw new Error("brand insert failed");

  const [version] = await db
    .insert(brandSizeChartVersions)
    .values({
      brandId: brand.id,
      brandSourceId: 1,
      sizeChartJson: sizeChart,
      confidenceScore: 0.9,
      confidenceBreakdownJson: { claudeReported: 0.9, structuralValidation: 1, cohortOutlier: 1 },
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      acceptedBy: "auto",
    })
    .returning();
  if (!version) throw new Error("version insert failed");

  await db
    .update(brands)
    .set({ currentSizeChartVersionId: version.id })
    .where(eq(brands.id, brand.id));

  return { brandId: brand.id };
}

async function seedCohort(db: ReturnType<typeof makeDb>) {
  const [cohort] = await db
    .insert(cohortSummaries)
    .values({
      scoringConfigVersion: "v1.0",
      brandCount: 10,
      summaryJson: cohortSummaryData,
      trigger: "manual",
    })
    .returning();
  if (!cohort) throw new Error("cohort insert failed");
}

async function seedItems(db: ReturnType<typeof makeDb>, brandId: number) {
  await db.insert(brandItems).values([
    {
      brandId,
      sourceUrl: "https://test.com/flagship-tee",
      name: "Flagship Tee",
      category: "tops",
      tierClassification: "flagship",
      perSizeDataJson: {
        S: { available: true, price: 80, colors: ["red", "blue"] },
        M: { available: true, price: 80, colors: ["red", "blue"] },
        L: { available: true, price: 80, colors: ["red", "blue"] },
        XL: { available: true, price: 80, colors: ["red", "blue"] },
        "2XL": { available: true, price: 85, colors: ["red", "blue"] },
        "3XL": { available: true, price: 85, colors: ["red", "blue"] },
      },
    },
    {
      brandId,
      sourceUrl: "https://test.com/mid-shorts",
      name: "Mid Shorts",
      category: "bottoms",
      tierClassification: "mid",
      perSizeDataJson: {
        XS: { available: true, price: 45 },
        S: { available: true, price: 45 },
        M: { available: true, price: 45 },
        L: { available: true, price: 45 },
        XL: { available: true, price: 45 },
        "2XL": { available: true, price: 48 },
      },
    },
    {
      brandId,
      sourceUrl: "https://test.com/basic-socks",
      name: "Basic Socks",
      category: "accessories",
      tierClassification: "basic",
      perSizeDataJson: {
        S: { available: true, price: 12 },
        M: { available: true, price: 12 },
        L: { available: true, price: 12 },
      },
    },
  ]);
}

interface ScoresJson {
  size_range_breadth: number | null;
  measurement_accuracy: number | null;
  range_parity: number | null;
  pricing_equity: number | null;
  colorway_equity: number | null;
  composite: number | null;
}

interface RangeParityBreakdown {
  categoryParity: number;
  tierParity: number;
}

interface InputsJson {
  sizeChartVersionId: number;
  itemCount: number;
  rangeParityBreakdown: RangeParityBreakdown;
}

describe("scoring-pipeline-phase2", () => {
  test("all 5 dimensions populated when items exist", async () => {
    const db = makeDb();
    const { brandId } = await seedBrand(db);
    await seedCohort(db);
    await seedItems(db, brandId);

    const handler = makeScoreBrandHandler({ db });
    await handler({ brandId }, mockCtx);

    const [row] = await db
      .select()
      .from(brandScoreHistory)
      .where(eq(brandScoreHistory.brandId, brandId));

    expect(row).toBeDefined();
    const scores = row?.scoresJson as unknown as ScoresJson | undefined;
    expect(scores?.size_range_breadth).not.toBeNull();
    expect(scores?.measurement_accuracy).not.toBeNull();
    expect(scores?.range_parity).not.toBeNull();
    expect(scores?.pricing_equity).not.toBeNull();
    expect(scores?.colorway_equity).not.toBeNull();
    expect(scores?.composite).not.toBeNull();

    // All dimension scores should be in 0-10 range
    const dimensions = [
      scores?.size_range_breadth,
      scores?.measurement_accuracy,
      scores?.range_parity,
      scores?.pricing_equity,
      scores?.colorway_equity,
    ];
    for (const val of dimensions) {
      if (val !== null && val !== undefined) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(10);
      }
    }
  });

  test("inputsJson includes itemCount and rangeParityBreakdown", async () => {
    const db = makeDb();
    const { brandId } = await seedBrand(db);
    await seedCohort(db);
    await seedItems(db, brandId);

    const handler = makeScoreBrandHandler({ db });
    await handler({ brandId }, mockCtx);

    const [row] = await db
      .select()
      .from(brandScoreHistory)
      .where(eq(brandScoreHistory.brandId, brandId));

    const inputs = row?.inputsJson as unknown as InputsJson | undefined;
    expect(inputs?.itemCount).toBeGreaterThan(0);
    expect(inputs?.rangeParityBreakdown).toBeDefined();
    expect(typeof inputs?.rangeParityBreakdown.categoryParity).toBe("number");
    expect(typeof inputs?.rangeParityBreakdown.tierParity).toBe("number");
  });

  test("range_parity, pricing_equity, colorway_equity null when no items", async () => {
    const db = makeDb();
    const { brandId } = await seedBrand(db);
    await seedCohort(db);
    // Do NOT seed items

    const handler = makeScoreBrandHandler({ db });
    await handler({ brandId }, mockCtx);

    const [row] = await db
      .select()
      .from(brandScoreHistory)
      .where(eq(brandScoreHistory.brandId, brandId));

    const scores = row?.scoresJson as unknown as ScoresJson | undefined;
    expect(scores?.range_parity).toBeNull();
    expect(scores?.pricing_equity).toBeNull();
    expect(scores?.colorway_equity).toBeNull();
    // Breadth and accuracy still scored from chart data
    expect(scores?.size_range_breadth).not.toBeNull();
    expect(scores?.measurement_accuracy).not.toBeNull();

    const inputs = row?.inputsJson as unknown as InputsJson | undefined;
    expect(inputs?.itemCount).toBe(0);
  });
});
