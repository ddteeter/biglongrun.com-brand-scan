import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import {
  brands,
  brandSizeChartVersions,
  cohortSummaries,
} from "../../src/infrastructure/db/schema";
import { recomputeCohortSummary } from "../../src/domain/scoring/cohort";
import { eq } from "drizzle-orm";

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
    CREATE TABLE cohort_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT,
      computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      scoring_config_version TEXT NOT NULL, brand_count INTEGER NOT NULL,
      summary_json TEXT NOT NULL, trigger TEXT NOT NULL);
  `);
  return drizzle(sqlite, { schema });
}

async function seedBrandWithChart(
  db: ReturnType<typeof makeDb>,
  slug: string,
  measurements: Record<
    string,
    { chest: [number, number]; waist: [number, number]; hip: [number, number] }
  >
) {
  const [b] = await db
    .insert(brands)
    .values({ slug, name: slug, primaryUrl: `https://${slug}.com` })
    .returning();
  if (!b) throw new Error("Failed to insert brand");
  const chart = {
    source_url: `https://${slug}.com/size`,
    extracted_at: new Date().toISOString(),
    method: "claude",
    size_labels: Object.keys(measurements),
    measurements: Object.fromEntries(
      Object.entries(measurements).map(([k, v]) => [
        k,
        { chest_in: v.chest, waist_in: v.waist, hip_in: v.hip },
      ])
    ),
    size_availability: [],
    notes: "",
    gender_specific: false,
  };
  const [v] = await db
    .insert(brandSizeChartVersions)
    .values({
      brandId: b.id,
      brandSourceId: 1,
      sizeChartJson: chart,
      confidenceScore: 0.9,
      confidenceBreakdownJson: { claudeReported: 0.9, structuralValidation: 1, cohortOutlier: 1 },
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      acceptedBy: "auto",
    })
    .returning();
  if (!v) throw new Error("Failed to insert version");
  await db.update(brands).set({ currentSizeChartVersionId: v.id }).where(eq(brands.id, b.id));
}

describe("recomputeCohortSummary", () => {
  test("aggregates per-size medians + breadth from accepted versions", async () => {
    const db = makeDb();
    await seedBrandWithChart(db, "a", {
      S: { chest: [36, 38], waist: [28, 30], hip: [36, 38] },
      M: { chest: [38, 40], waist: [30, 32], hip: [38, 40] },
    });
    await seedBrandWithChart(db, "b", {
      S: { chest: [34, 36], waist: [26, 28], hip: [34, 36] },
      M: { chest: [36, 38], waist: [28, 30], hip: [36, 38] },
      L: { chest: [38, 40], waist: [30, 32], hip: [38, 40] },
    });
    await seedBrandWithChart(db, "c", {
      S: { chest: [38, 40], waist: [30, 32], hip: [38, 40] },
      M: { chest: [40, 42], waist: [32, 34], hip: [40, 42] },
      XL: { chest: [44, 46], waist: [36, 38], hip: [44, 46] },
    });

    const id = await recomputeCohortSummary({ db, trigger: "manual" });

    const [row] = await db.select().from(cohortSummaries).where(eq(cohortSummaries.id, id));
    expect(row?.brandCount).toBe(3);
    const summary = row?.summaryJson as
      | { perSize: Record<string, unknown>; breadths: number[] }
      | undefined;
    expect(summary?.perSize.S).toBeDefined();
    expect(summary?.breadths).toHaveLength(3);
  });

  test("returns the new summary id", async () => {
    const db = makeDb();
    await seedBrandWithChart(db, "a", { S: { chest: [36, 38], waist: [28, 30], hip: [36, 38] } });
    const id = await recomputeCohortSummary({ db, trigger: "scheduled" });
    expect(id).toBeGreaterThan(0);
  });
});
