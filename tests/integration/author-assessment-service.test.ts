import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import { brands } from "../../src/infrastructure/db/schema";
import { AuthorAssessmentService } from "../../src/domain/assessments";

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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return drizzle(sqlite, { schema });
}

describe("AuthorAssessmentService", () => {
  let db: ReturnType<typeof makeDb>;
  let service: AuthorAssessmentService;
  let brandId: number;

  beforeEach(async () => {
    db = makeDb();
    service = new AuthorAssessmentService(db);
    const [b] = await db
      .insert(brands)
      .values({ slug: "x", name: "X", primaryUrl: "https://x.com" })
      .returning();
    if (!b) throw new Error("brand setup");
    brandId = b.id;
  });

  const goodRatings = {
    size_options: 7,
    tier_equity: 5,
    pricing_equity: 8,
    fit_label_honesty: 6,
    overall_inclusivity: 6.5,
  };

  test("create inserts a new assessment with defaults", async () => {
    const id = await service.create({
      brandId,
      authorSlug: "drew",
      ratings: goodRatings,
    });
    const a = await service.findById(id);
    expect(a?.proseMarkdown).toBe("");
    expect(a?.authorSlug).toBe("drew");
  });

  test("create rejects out-of-range ratings", () => {
    expect(
      service.create({
        brandId,
        authorSlug: "drew",
        ratings: { ...goodRatings, size_options: 11 },
      })
    ).rejects.toThrow();
  });

  test("update replaces ratings + prose, leaves other fields", async () => {
    const id = await service.create({
      brandId,
      authorSlug: "drew",
      ratings: goodRatings,
      proseMarkdown: "v1",
    });
    await service.update({ id, proseMarkdown: "v2" });
    const a = await service.findById(id);
    expect(a?.proseMarkdown).toBe("v2");
    expect((a?.ratingsJson as typeof goodRatings).size_options).toBe(7);
  });

  test("listForBrand returns all assessments sorted by assessment_date desc", async () => {
    await service.create({
      brandId,
      authorSlug: "drew",
      ratings: goodRatings,
      assessmentDate: "2026-01-01",
    });
    await service.create({
      brandId,
      authorSlug: "drew",
      ratings: goodRatings,
      assessmentDate: "2026-05-01",
    });
    const list = await service.listForBrand(brandId);
    expect(list.length).toBe(2);
    expect(list[0]?.assessmentDate).toBe("2026-05-01");
  });
});
