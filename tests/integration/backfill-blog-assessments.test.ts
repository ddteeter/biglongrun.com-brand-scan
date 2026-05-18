import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import nodePath from "node:path";
import * as schema from "../../src/infrastructure/db/schema";
import { brands, authorBrandAssessments } from "../../src/infrastructure/db/schema";
import { runBackfill } from "../../src/domain/assessments/backfill";
import type { BackfillOptions } from "../../src/domain/assessments/backfill";

const DDL = `
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
`;

// The fixture blog reviews live in tests/fixtures/blog-reviews.
// We pass that directory as if it were `<blogRepo>/src/content/reviews`.
const FIXTURE_BLOG_REPO = nodePath.join(import.meta.dir, "../fixtures");
const FIXTURE_REVIEWS_DIR = "blog-reviews";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON;");
  sqlite.run(DDL);
  return drizzle(sqlite, { schema });
}

describe("runBackfill", () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();
    // Seed the two fixture brands so the backfill can find them
    await db.insert(brands).values([
      { slug: "tracksmith", name: "Tracksmith", primaryUrl: "https://tracksmith.com" },
      { slug: "path-projects", name: "Path Projects", primaryUrl: "https://pathprojects.com" },
    ]);
  });

  function makeOptions(overrides: Partial<BackfillOptions> = {}): BackfillOptions {
    return {
      db,
      blogRepo: FIXTURE_BLOG_REPO,
      reviewsDir: FIXTURE_REVIEWS_DIR,
      dryRun: false,
      ...overrides,
    };
  }

  test("creates assessments for 2 fixture brands with correct origin", async () => {
    const summary = await runBackfill(makeOptions());
    expect(summary.created).toBe(2);
    expect(summary.skipped).toBe(0);

    const rows = await db.select().from(authorBrandAssessments);
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row.origin).toBe("backfilled_from_blog_review");
    }
  });

  test("sourceReviewUrl is populated from fixture frontmatter", async () => {
    await runBackfill(makeOptions());

    const rows = await db.select().from(authorBrandAssessments);
    const tracksmithRow = rows.find((r) => r.assessmentDate === "2025-08-12");
    expect(tracksmithRow?.sourceReviewUrl).toBe(
      "https://biglongrun.com/reviews/tracksmith-storm-shorts"
    );
  });

  test("size_options rating is populated from fixture frontmatter", async () => {
    await runBackfill(makeOptions());

    const rows = await db.select().from(authorBrandAssessments);
    const tracksmithRow = rows.find((r) => r.assessmentDate === "2025-08-12");
    expect((tracksmithRow?.ratingsJson as { size_options: number }).size_options).toBe(4);

    const ppRow = rows.find((r) => r.assessmentDate === "2025-03-20");
    expect((ppRow?.ratingsJson as { size_options: number }).size_options).toBe(7);
  });

  test("dry-run does NOT create rows but logs intent", async () => {
    const logged: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => {
      logged.push(msg);
    };

    try {
      const summary = await runBackfill(makeOptions({ dryRun: true }));
      // dry-run counts skipped, not created
      expect(summary.created).toBe(0);

      const rows = await db.select().from(authorBrandAssessments);
      expect(rows).toHaveLength(0);

      const dryRunLogs = logged.filter((m) => m.includes("[dry-run]"));
      expect(dryRunLogs.length).toBeGreaterThanOrEqual(2);
    } finally {
      console.log = origLog;
    }
  });

  test("missing brand is skipped with a warning", async () => {
    // Use a fresh DB with only Tracksmith — Path Projects intentionally omitted
    const sqlite2 = new Database(":memory:");
    sqlite2.run("PRAGMA foreign_keys = ON;");
    sqlite2.run(DDL);
    const db2 = drizzle(sqlite2, { schema });
    await db2
      .insert(brands)
      .values([{ slug: "tracksmith", name: "Tracksmith", primaryUrl: "https://tracksmith.com" }]);

    const warned: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => {
      warned.push(msg);
    };

    try {
      const summary = await runBackfill({
        db: db2,
        blogRepo: FIXTURE_BLOG_REPO,
        reviewsDir: FIXTURE_REVIEWS_DIR,
        dryRun: false,
      });

      expect(summary.created).toBe(1); // only Tracksmith
      expect(summary.skipped).toBe(1); // Path Projects missing

      const warningFound = warned.some((m) => m.includes("path-projects"));
      expect(warningFound).toBe(true);

      const rows = await db2.select().from(authorBrandAssessments);
      expect(rows).toHaveLength(1);
    } finally {
      console.warn = origWarn;
    }
  });
});
