import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import {
  cohortSummaries,
  brandScoreHistory,
  brandScoreSnapshots,
} from "../../src/infrastructure/db/schema/scoring";

describe("scoring schema", () => {
  let db: ReturnType<typeof drizzle>;
  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.run(`
      CREATE TABLE cohort_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        computed_at TEXT NOT NULL DEFAULT (datetime('now')),
        scoring_config_version TEXT NOT NULL,
        brand_count INTEGER NOT NULL,
        summary_json TEXT NOT NULL,
        trigger TEXT NOT NULL CHECK (trigger IN ('scheduled','manual','data_threshold'))
      );
      CREATE TABLE brand_score_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand_id INTEGER NOT NULL,
        computed_at TEXT NOT NULL DEFAULT (datetime('now')),
        scoring_config_version TEXT NOT NULL,
        cohort_summary_id INTEGER NOT NULL REFERENCES cohort_summaries(id),
        scores_json TEXT NOT NULL, inputs_json TEXT NOT NULL
      );
      CREATE TABLE brand_score_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand_id INTEGER NOT NULL,
        snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
        promoted_from_history_id INTEGER NOT NULL REFERENCES brand_score_history(id),
        cohort_summary_id INTEGER NOT NULL REFERENCES cohort_summaries(id),
        scores_json TEXT NOT NULL,
        is_public INTEGER NOT NULL DEFAULT 0
      );
    `);
    db = drizzle(sqlite);
  });

  test("inserts cohort summary + history + snapshot", async () => {
    const [c] = await db
      .insert(cohortSummaries)
      .values({
        scoringConfigVersion: "v1.0",
        brandCount: 5,
        summaryJson: { foo: 1 },
        trigger: "scheduled",
      })
      .returning();
    if (!c) throw new Error("Cohort summary insert failed");
    const [h] = await db
      .insert(brandScoreHistory)
      .values({
        brandId: 1,
        scoringConfigVersion: "v1.0",
        cohortSummaryId: c.id,
        scoresJson: { composite: 7.5 },
        inputsJson: { sizeChartVersionId: 10 },
      })
      .returning();
    if (!h) throw new Error("Brand score history insert failed");
    const [s] = await db
      .insert(brandScoreSnapshots)
      .values({
        brandId: 1,
        promotedFromHistoryId: h.id,
        cohortSummaryId: c.id,
        scoresJson: { composite: 7.5 },
        isPublic: true,
      })
      .returning();
    expect(s?.isPublic).toBe(true);
  });
});
