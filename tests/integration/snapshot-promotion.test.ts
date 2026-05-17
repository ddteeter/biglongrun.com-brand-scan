import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import {
  brandScoreHistory,
  brandScoreSnapshots,
  cohortSummaries,
} from "../../src/infrastructure/db/schema";
import { promoteSnapshotIfWarranted } from "../../src/domain/scoring/snapshot";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.run(`
    CREATE TABLE cohort_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT,
      computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      scoring_config_version TEXT NOT NULL, brand_count INTEGER NOT NULL,
      summary_json TEXT NOT NULL, trigger TEXT NOT NULL);
    CREATE TABLE brand_score_history (id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER NOT NULL, computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      scoring_config_version TEXT NOT NULL, cohort_summary_id INTEGER NOT NULL,
      scores_json TEXT NOT NULL, inputs_json TEXT NOT NULL);
    CREATE TABLE brand_score_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER NOT NULL, snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
      promoted_from_history_id INTEGER NOT NULL, cohort_summary_id INTEGER NOT NULL,
      scores_json TEXT NOT NULL, is_public INTEGER NOT NULL DEFAULT 0);
  `);
  return drizzle(sqlite, { schema });
}

async function seedHistory(db: ReturnType<typeof makeDb>, brandId: number, composites: number[]) {
  const [c] = await db
    .insert(cohortSummaries)
    .values({ scoringConfigVersion: "v1.0", brandCount: 5, summaryJson: {}, trigger: "scheduled" })
    .returning();
  if (!c) throw new Error("Failed to insert cohort summary");
  const ids: number[] = [];
  for (const composite of composites) {
    const [h] = await db
      .insert(brandScoreHistory)
      .values({
        brandId,
        scoringConfigVersion: "v1.0",
        cohortSummaryId: c.id,
        scoresJson: { composite },
        inputsJson: { sizeChartVersionId: 1 },
      })
      .returning();
    if (!h) throw new Error("Failed to insert history");
    ids.push(h.id);
  }
  return { cohortId: c.id, historyIds: ids };
}

describe("promoteSnapshotIfWarranted", () => {
  // beforeEach documents that each test creates its own db for isolation
  beforeEach(() => {
    // fresh db per test via makeDb() in each test body
  });

  test("promotes first snapshot when cohort large enough", async () => {
    const db = makeDb();
    const { cohortId, historyIds } = await seedHistory(db, 1, [7.5]);
    const firstHistoryId = historyIds[0];
    if (firstHistoryId === undefined) throw new Error("No history id");
    const result = await promoteSnapshotIfWarranted({
      db,
      brandId: 1,
      latestHistoryId: firstHistoryId,
      cohortSummaryId: cohortId,
      cohortBrandCount: 5,
    });
    expect(result.promoted).toBe(true);
    const snaps = await db.select().from(brandScoreSnapshots);
    expect(snaps[0]?.isPublic).toBe(true);
  });

  test("does not promote on small movement", async () => {
    const db = makeDb();
    const seeded = await seedHistory(db, 1, [7.5, 7.6, 7.55, 7.6]);
    const firstId = seeded.historyIds[0];
    const lastId = seeded.historyIds[3];
    if (firstId === undefined || lastId === undefined) throw new Error("No history ids");
    await promoteSnapshotIfWarranted({
      db,
      brandId: 1,
      latestHistoryId: firstId,
      cohortSummaryId: seeded.cohortId,
      cohortBrandCount: 5,
    });
    const r = await promoteSnapshotIfWarranted({
      db,
      brandId: 1,
      latestHistoryId: lastId,
      cohortSummaryId: seeded.cohortId,
      cohortBrandCount: 5,
    });
    expect(r.promoted).toBe(false);
  });

  test("promotes on sustained shift > 0.5 in same direction across 3 rows", async () => {
    const db = makeDb();
    const seeded = await seedHistory(db, 1, [7, 7.5, 8, 8.5]);
    const firstId = seeded.historyIds[0];
    const lastId = seeded.historyIds[3];
    if (firstId === undefined || lastId === undefined) throw new Error("No history ids");
    // First promote initial snapshot from first history row (7)
    await promoteSnapshotIfWarranted({
      db,
      brandId: 1,
      latestHistoryId: firstId,
      cohortSummaryId: seeded.cohortId,
      cohortBrandCount: 5,
    });
    // Now promote with the last history row (8.5); the 3 most recent in desc order
    // are [8.5, 8.0, 7.5] — all decreasing in array order = increasing over time
    // delta = |8.5 - 7.0| = 1.5 >= 0.5
    const r = await promoteSnapshotIfWarranted({
      db,
      brandId: 1,
      latestHistoryId: lastId,
      cohortSummaryId: seeded.cohortId,
      cohortBrandCount: 5,
    });
    expect(r.promoted).toBe(true);
  });

  test("marks is_public false when cohort below MIN_COHORT_SIZE_FOR_PUBLIC", async () => {
    const db = makeDb();
    const seeded = await seedHistory(db, 1, [7.5]);
    const firstId = seeded.historyIds[0];
    if (firstId === undefined) throw new Error("No history id");
    await promoteSnapshotIfWarranted({
      db,
      brandId: 1,
      latestHistoryId: firstId,
      cohortSummaryId: seeded.cohortId,
      cohortBrandCount: 3,
    });
    const snaps = await db.select().from(brandScoreSnapshots);
    expect(snaps[0]?.isPublic).toBe(false);
  });
});
