import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import { brands } from "../../src/infrastructure/db/schema";
import { publicApi } from "../../src/public-api";
import { AuthorAssessmentService } from "../../src/domain/assessments";

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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON;");
  sqlite.run(DDL);
  return drizzle(sqlite, { schema });
}

const TOKEN = "test-token";
const headers = { authorization: `Bearer ${TOKEN}` };

const goodRatings = {
  size_options: 7,
  tier_equity: 5,
  pricing_equity: 8,
  fit_label_honesty: 6,
  overall_inclusivity: 6,
};

describe("GET /api/v1/brands/:slug/assessments", () => {
  let db: ReturnType<typeof makeDb>;
  let app: ReturnType<typeof publicApi>;

  beforeEach(() => {
    db = makeDb();
    app = publicApi({ db, bearerToken: TOKEN, bootedAt: new Date() });
  });

  test("returns 404 for unknown brand slug", async () => {
    const r = await app.handle(
      new Request("http://localhost/api/v1/brands/no-such-brand/assessments", { headers })
    );
    expect(r.status).toBe(404);
    const json = (await r.json()) as { type: string };
    expect(json.type).toContain("not-found");
  });

  test("returns empty assessments array for brand with no assessments", async () => {
    await db.insert(brands).values({ slug: "acme", name: "Acme", primaryUrl: "https://acme.com" });
    const r = await app.handle(
      new Request("http://localhost/api/v1/brands/acme/assessments", { headers })
    );
    expect(r.status).toBe(200);
    const json = (await r.json()) as { slug: string; count: number; assessments: unknown[] };
    expect(json.slug).toBe("acme");
    expect(json.count).toBe(0);
    expect(json.assessments).toEqual([]);
  });

  test("returns 2 assessments sorted by date desc with proseHtml populated", async () => {
    const [b] = await db
      .insert(brands)
      .values({ slug: "tracksmith", name: "Tracksmith", primaryUrl: "https://tracksmith.com" })
      .returning();
    if (!b) throw new Error("brand insert failed");

    const svc = new AuthorAssessmentService(db);
    await svc.create({
      brandId: b.id,
      authorSlug: "drew",
      ratings: goodRatings,
      proseMarkdown: "**Older review**",
      assessmentDate: "2025-01-01",
    });
    await svc.create({
      brandId: b.id,
      authorSlug: "drew",
      ratings: goodRatings,
      proseMarkdown: "**Newer review**",
      assessmentDate: "2025-06-01",
    });

    const r = await app.handle(
      new Request("http://localhost/api/v1/brands/tracksmith/assessments", { headers })
    );
    expect(r.status).toBe(200);

    const json = (await r.json()) as {
      slug: string;
      count: number;
      assessments: {
        authorSlug: string;
        assessmentDate: string;
        ratings: typeof goodRatings;
        proseMarkdown: string;
        proseHtml: string;
      }[];
    };

    expect(json.slug).toBe("tracksmith");
    expect(json.count).toBe(2);
    expect(json.assessments).toHaveLength(2);

    // sorted date desc: newest first
    expect(json.assessments[0]?.assessmentDate).toBe("2025-06-01");
    expect(json.assessments[1]?.assessmentDate).toBe("2025-01-01");

    // proseHtml is populated from markdown
    expect(json.assessments[0]?.proseHtml).toContain("<strong>Newer review</strong>");
    expect(json.assessments[1]?.proseHtml).toContain("<strong>Older review</strong>");

    // ratings are present
    expect(json.assessments[0]?.ratings.size_options).toBe(7);
  });

  test("ETag returns 304 on If-None-Match", async () => {
    await db
      .insert(brands)
      .values({ slug: "path-projects", name: "Path Projects", primaryUrl: "https://path.com" });

    const r1 = await app.handle(
      new Request("http://localhost/api/v1/brands/path-projects/assessments", { headers })
    );
    expect(r1.status).toBe(200);
    const etag = r1.headers.get("etag");
    expect(etag).not.toBeNull();

    const r2 = await app.handle(
      new Request("http://localhost/api/v1/brands/path-projects/assessments", {
        headers: { ...headers, "if-none-match": etag ?? "" },
      })
    );
    expect(r2.status).toBe(304);
  });
});
