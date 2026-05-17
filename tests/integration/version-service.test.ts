import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import * as schema from "../../src/infrastructure/db/schema";
import { brands, brandSizeChartVersions } from "../../src/infrastructure/db/schema";
import { VersionService } from "../../src/domain/extraction/version-service";

const CHART = {
  source_url: "https://tracksmith.com/pages/size-chart",
  extracted_at: new Date().toISOString(),
  method: "claude" as const,
  size_labels: ["S", "M", "L"],
  measurements: {
    S: {
      chest_in: [34, 36] as [number, number],
      waist_in: [28, 30] as [number, number],
      hip_in: [36, 38] as [number, number],
    },
    M: {
      chest_in: [36, 38] as [number, number],
      waist_in: [30, 32] as [number, number],
      hip_in: [38, 40] as [number, number],
    },
    L: {
      chest_in: [38, 40] as [number, number],
      waist_in: [32, 34] as [number, number],
      hip_in: [40, 42] as [number, number],
    },
  },
  size_availability: [],
  notes: "",
  gender_specific: "unisex" as const,
};

const CONFIDENCE = {
  composite: 0.9,
  breakdown: { claudeReported: 0.9, structuralValidation: 1, cohortOutlier: 1 },
};

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

describe("VersionService", () => {
  let db: ReturnType<typeof makeDb>;
  let service: VersionService;
  let brandId: number;

  beforeEach(async () => {
    db = makeDb();
    service = new VersionService(db);
    const [b] = await db
      .insert(brands)
      .values({ slug: "tracksmith", name: "Tracksmith", primaryUrl: "https://tracksmith.com" })
      .returning();
    if (!b) throw new Error("brand insert failed");
    brandId = b.id;
  });

  test("recordExtraction with status=accepted supersedes prior accepted + updates brand pointer", async () => {
    // Insert a prior accepted version
    const [prior] = await db
      .insert(brandSizeChartVersions)
      .values({
        brandId,
        brandSourceId: 1,
        sizeChartJson: { v: 1 },
        confidenceScore: 0.9,
        confidenceBreakdownJson: { claudeReported: 0.9, structuralValidation: 1, cohortOutlier: 1 },
        status: "accepted",
      })
      .returning();
    if (!prior) throw new Error("prior version insert failed");

    const version = await service.recordExtraction({
      brandId,
      brandSourceId: 1,
      runId: 42,
      chart: CHART,
      confidence: CONFIDENCE,
      deltaFromPrior: { fieldsChanged: 2 },
      status: "accepted",
      acceptedBy: "auto",
    });

    expect(version.status).toBe("accepted");
    expect(version.acceptedBy).toBe("auto");
    expect(version.acceptedAt).not.toBeNull();

    // Prior version must be superseded
    const [priorRefreshed] = await db
      .select()
      .from(brandSizeChartVersions)
      .where(eq(brandSizeChartVersions.id, prior.id));
    expect(priorRefreshed?.status).toBe("superseded");

    // Brand pointer must be updated
    const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
    expect(brand?.currentSizeChartVersionId).toBe(version.id);
  });

  test("recordExtraction with status=pending_review just inserts (no supersession, no brand update)", async () => {
    // Insert a prior accepted version
    await db.insert(brandSizeChartVersions).values({
      brandId,
      brandSourceId: 1,
      sizeChartJson: { v: 1 },
      confidenceScore: 0.9,
      confidenceBreakdownJson: { claudeReported: 0.9, structuralValidation: 1, cohortOutlier: 1 },
      status: "accepted",
    });

    const version = await service.recordExtraction({
      brandId,
      brandSourceId: 1,
      runId: 43,
      chart: CHART,
      confidence: {
        composite: 0.3,
        breakdown: { claudeReported: 0.3, structuralValidation: 1, cohortOutlier: 1 },
      },
      deltaFromPrior: { fieldsChanged: 5 },
      status: "pending_review",
    });

    expect(version.status).toBe("pending_review");
    expect(version.acceptedBy).toBeNull();
    expect(version.acceptedAt).toBeNull();

    // Prior version must still be accepted
    const allVersions = await db.select().from(brandSizeChartVersions);
    const accepted = allVersions.filter((v) => v.status === "accepted");
    expect(accepted).toHaveLength(1);

    // Brand pointer must NOT have changed
    const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
    expect(brand?.currentSizeChartVersionId).toBeNull();
  });

  test("approve transitions from pending_review to accepted correctly", async () => {
    // Insert a prior accepted version and a pending_review version
    const [prior] = await db
      .insert(brandSizeChartVersions)
      .values({
        brandId,
        brandSourceId: 1,
        sizeChartJson: { v: 1 },
        confidenceScore: 0.9,
        confidenceBreakdownJson: { claudeReported: 0.9, structuralValidation: 1, cohortOutlier: 1 },
        status: "accepted",
      })
      .returning();
    if (!prior) throw new Error("prior version insert failed");

    const [pending] = await db
      .insert(brandSizeChartVersions)
      .values({
        brandId,
        brandSourceId: 1,
        sizeChartJson: { v: 2 },
        confidenceScore: 0.5,
        confidenceBreakdownJson: { claudeReported: 0.5, structuralValidation: 1, cohortOutlier: 1 },
        status: "pending_review",
      })
      .returning();
    if (!pending) throw new Error("pending version insert failed");

    const result = await service.approve({
      versionId: pending.id,
      acceptedBy: "human:drew",
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe("accepted");
    expect(result?.acceptedBy).toBe("human:drew");

    // Prior must be superseded
    const [priorRefreshed] = await db
      .select()
      .from(brandSizeChartVersions)
      .where(eq(brandSizeChartVersions.id, prior.id));
    expect(priorRefreshed?.status).toBe("superseded");

    // Brand pointer must point at the newly approved version
    const [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
    expect(brand?.currentSizeChartVersionId).toBe(pending.id);
  });

  test("approve of nonexistent version returns null", async () => {
    const result = await service.approve({ versionId: 99_999, acceptedBy: "human:drew" });
    expect(result).toBeNull();
  });

  test("reject without reason throws", () => {
    expect(service.reject({ versionId: 1, reason: "" })).rejects.toThrow(
      "reject requires a reason"
    );
    expect(service.reject({ versionId: 1, reason: "   " })).rejects.toThrow(
      "reject requires a reason"
    );
  });
});
