import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { brands } from "../../src/infrastructure/db/schema/brands";
import { authorBrandAssessments } from "../../src/infrastructure/db/schema/assessments";

describe("author_brand_assessments schema", () => {
  let db: ReturnType<typeof drizzle>;
  beforeEach(() => {
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
    db = drizzle(sqlite);
  });

  test("inserts a native assessment with all 5 ratings", async () => {
    const [b] = await db
      .insert(brands)
      .values({ slug: "x", name: "X", primaryUrl: "https://x.com" })
      .returning();
    if (!b) throw new Error("brand setup");
    const [a] = await db
      .insert(authorBrandAssessments)
      .values({
        brandId: b.id,
        authorSlug: "drew",
        ratingsJson: {
          size_options: 7,
          tier_equity: 5,
          pricing_equity: 8,
          fit_label_honesty: 6,
          overall_inclusivity: 6.5,
        },
        proseMarkdown: "Some prose.",
      })
      .returning();
    expect((a?.ratingsJson as { overall_inclusivity: number }).overall_inclusivity).toBe(6.5);
    expect(a?.proseMarkdown).toBe("Some prose.");
  });

  test("cascade-deletes when brand deleted", async () => {
    const [b] = await db
      .insert(brands)
      .values({ slug: "x", name: "X", primaryUrl: "https://x.com" })
      .returning();
    if (!b) throw new Error("brand setup");
    await db.insert(authorBrandAssessments).values({
      brandId: b.id,
      authorSlug: "drew",
      ratingsJson: {
        size_options: 5,
        tier_equity: 5,
        pricing_equity: 5,
        fit_label_honesty: 5,
        overall_inclusivity: 5,
      },
    });
    await db.delete(brands).where(eq(brands.id, b.id));
    const remaining = await db.select().from(authorBrandAssessments);
    expect(remaining.length).toBe(0);
  });
});
