import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Elysia, type AnyElysia } from "elysia";
import * as schema from "../../src/infrastructure/db/schema";
import { brands } from "../../src/infrastructure/db/schema";
import { authorBrandAssessments } from "../../src/infrastructure/db/schema";
import { assessmentActions } from "../../src/admin-ui/actions/assessment";
import { AuthorAssessmentService } from "../../src/domain/assessments";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON;");
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
    CREATE TABLE author_brand_assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      author_slug TEXT NOT NULL,
      assessment_date TEXT NOT NULL DEFAULT (date('now')),
      ratings_json TEXT NOT NULL,
      prose_markdown TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL CHECK (origin IN ('native','backfilled_from_blog_review')),
      source_review_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return drizzle(sqlite, { schema });
}

const GOOD_RATINGS = {
  size_options: 7,
  tier_equity: 5,
  pricing_equity: 8,
  fit_label_honesty: 6,
  overall_inclusivity: 6.5,
};

describe("assessmentActions", () => {
  let db: ReturnType<typeof makeDb>;
  let app: AnyElysia;
  let brandId: number;

  beforeEach(async () => {
    db = makeDb();
    app = new Elysia().use(assessmentActions({ db, authorSlug: "drew" }));
    const [b] = await db
      .insert(brands)
      .values({ slug: "acme", name: "Acme", primaryUrl: "https://acme.com" })
      .returning();
    if (!b) throw new Error("brand setup failed");
    brandId = b.id;
  });

  test("POST create succeeds and creates a row in the DB", async () => {
    const form = new FormData();
    form.set("rating_size_options", "7");
    form.set("rating_tier_equity", "5");
    form.set("rating_pricing_equity", "8");
    form.set("rating_fit_label_honesty", "6");
    form.set("rating_overall_inclusivity", "6.5");
    form.set("proseMarkdown", "Some great prose.");

    const r = await app.handle(
      new Request("http://localhost/admin/brands/acme/assessments/create", {
        method: "POST",
        body: form,
      })
    );
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/admin/brands/acme?tab=assessments");

    const rows = await db.select().from(authorBrandAssessments);
    expect(rows.length).toBe(1);
    expect(rows[0]?.authorSlug).toBe("drew");
    expect(rows[0]?.proseMarkdown).toBe("Some great prose.");
  });

  test("POST create returns 404 for unknown brand slug", async () => {
    const form = new FormData();
    form.set("rating_size_options", "5");
    form.set("rating_tier_equity", "5");
    form.set("rating_pricing_equity", "5");
    form.set("rating_fit_label_honesty", "5");
    form.set("rating_overall_inclusivity", "5");

    const r = await app.handle(
      new Request("http://localhost/admin/brands/no-such-brand/assessments/create", {
        method: "POST",
        body: form,
      })
    );
    expect(r.status).toBe(404);
  });

  test("POST create returns 400 for out-of-range rating", async () => {
    const form = new FormData();
    form.set("rating_size_options", "99"); // invalid
    form.set("rating_tier_equity", "5");
    form.set("rating_pricing_equity", "5");
    form.set("rating_fit_label_honesty", "5");
    form.set("rating_overall_inclusivity", "5");

    const r = await app.handle(
      new Request("http://localhost/admin/brands/acme/assessments/create", {
        method: "POST",
        body: form,
      })
    );
    expect(r.status).toBe(400);
  });

  test("POST preview returns sanitized HTML", async () => {
    const form = new FormData();
    form.set("proseMarkdown", "# Hello\n\n**bold** <script>alert(1)</script>");

    const r = await app.handle(
      new Request("http://localhost/admin/brands/acme/assessments/preview", {
        method: "POST",
        body: form,
      })
    );
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain("<h1>Hello</h1>");
    expect(body).toContain("<strong>bold</strong>");
    expect(body).not.toContain("<script>");
  });

  test("POST update endpoint updates assessment fields", async () => {
    const service = new AuthorAssessmentService(db);
    const id = await service.create({
      brandId,
      authorSlug: "drew",
      ratings: GOOD_RATINGS,
      proseMarkdown: "original prose",
    });

    const form = new FormData();
    form.set("proseMarkdown", "updated prose");
    form.set("rating_size_options", "8");
    form.set("rating_tier_equity", "8");
    form.set("rating_pricing_equity", "8");
    form.set("rating_fit_label_honesty", "8");
    form.set("rating_overall_inclusivity", "8");

    const r = await app.handle(
      new Request(`http://localhost/admin/assessments/${String(id)}/update`, {
        method: "POST",
        body: form,
      })
    );
    expect(r.status).toBe(302);

    const updated = await service.findById(id);
    expect(updated?.proseMarkdown).toBe("updated prose");
    expect((updated?.ratingsJson as { size_options: number }).size_options).toBe(8);
  });
});
