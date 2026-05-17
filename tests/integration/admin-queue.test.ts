import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Elysia, type AnyElysia } from "elysia";
import { eq } from "drizzle-orm";
import * as schema from "../../src/infrastructure/db/schema";
import { brands, brandSizeChartVersions } from "../../src/infrastructure/db/schema";
import { queueActions } from "../../src/admin-ui/actions/queue";

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
  `);
  sqlite.run(`
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
  `);
  return drizzle(sqlite, { schema });
}

describe("queueActions", () => {
  let db: ReturnType<typeof makeDb>;
  let app: AnyElysia;

  beforeEach(() => {
    db = makeDb();
    app = new Elysia().use(queueActions({ db, authorSlug: "drew" }));
  });

  test("approve marks accepted and supersedes prior", async () => {
    const [b] = await db
      .insert(brands)
      .values({ slug: "x", name: "X", primaryUrl: "https://x.com" })
      .returning();
    if (!b) throw new Error("brand insert failed");

    await db.insert(brandSizeChartVersions).values({
      brandId: b.id,
      brandSourceId: 1,
      sizeChartJson: { v: 1 },
      confidenceScore: 1,
      confidenceBreakdownJson: { claudeReported: 1, structuralValidation: 1, cohortOutlier: 1 },
      status: "accepted",
    });

    const [pending] = await db
      .insert(brandSizeChartVersions)
      .values({
        brandId: b.id,
        brandSourceId: 1,
        sizeChartJson: { v: 2 },
        confidenceScore: 0.7,
        confidenceBreakdownJson: { claudeReported: 0.7, structuralValidation: 1, cohortOutlier: 1 },
        status: "pending_review",
      })
      .returning();
    if (!pending) throw new Error("version insert failed");

    const form = new FormData();
    form.set("size_chart_json", JSON.stringify({ v: 2 }));
    const r = await app.handle(
      new Request(`http://localhost/admin/queue/${String(pending.id)}/approve`, {
        method: "POST",
        body: form,
      })
    );
    expect(r.status).toBe(302);

    const versions = await db
      .select()
      .from(brandSizeChartVersions)
      .orderBy(brandSizeChartVersions.id);
    expect(versions[0]?.status).toBe("superseded");
    expect(versions[1]?.status).toBe("accepted");
    expect(versions[1]?.acceptedBy).toBe("human:drew");

    const [brand] = await db.select().from(brands).where(eq(brands.id, b.id));
    expect(brand?.currentSizeChartVersionId).toBe(pending.id);
  });

  test("reject without reason returns 400", async () => {
    const [b] = await db
      .insert(brands)
      .values({ slug: "y", name: "Y", primaryUrl: "https://y.com" })
      .returning();
    if (!b) throw new Error("brand insert failed");

    const [pending] = await db
      .insert(brandSizeChartVersions)
      .values({
        brandId: b.id,
        brandSourceId: 1,
        sizeChartJson: {},
        confidenceScore: 0.3,
        confidenceBreakdownJson: { claudeReported: 0.3, structuralValidation: 1, cohortOutlier: 1 },
        status: "pending_review",
      })
      .returning();
    if (!pending) throw new Error("version insert failed");

    const form = new FormData();
    const r = await app.handle(
      new Request(`http://localhost/admin/queue/${String(pending.id)}/reject`, {
        method: "POST",
        body: form,
      })
    );
    expect(r.status).toBe(400);
  });
});
