import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { brands } from "../../src/infrastructure/db/schema/brands";
import { brandSizeChartVersions } from "../../src/infrastructure/db/schema/versions";

describe("brand_size_chart_versions schema", () => {
  let db: ReturnType<typeof drizzle>;

  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.run("PRAGMA foreign_keys = ON;");
    sqlite.run(`
      CREATE TABLE brands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, primary_url TEXT NOT NULL,
        category_tag TEXT NOT NULL DEFAULT 'running',
        audience_tags TEXT NOT NULL DEFAULT '[]',
        current_size_chart_version_id INTEGER,
        divergence_flag INTEGER NOT NULL DEFAULT 0,
        predicted_next_change_at TEXT, cadence_learned_at TEXT,
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
        accepted_at TEXT, accepted_by TEXT, rejection_reason TEXT,
        supersedes_version_id INTEGER REFERENCES brand_size_chart_versions(id),
        delta_from_prior_json TEXT
      );
    `);
    db = drizzle(sqlite);
  });

  test("inserts a pending version", async () => {
    const [b] = await db
      .insert(brands)
      .values({
        slug: "x",
        name: "X",
        primaryUrl: "https://x.com",
      })
      .returning();
    if (!b) throw new Error("Brand insert failed");
    const [v] = await db
      .insert(brandSizeChartVersions)
      .values({
        brandId: b.id,
        brandSourceId: 1,
        sizeChartJson: { measurements: {} },
        confidenceScore: 0.5,
        confidenceBreakdownJson: { claudeReported: 0.5, structuralValidation: 1, cohortOutlier: 1 },
        status: "pending_review",
      })
      .returning();
    expect(v?.status).toBe("pending_review");
    expect(v?.confidenceScore).toBe(0.5);
  });
});
