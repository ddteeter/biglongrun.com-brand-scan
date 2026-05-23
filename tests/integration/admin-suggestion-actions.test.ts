import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Elysia, type AnyElysia } from "elysia";
import * as schema from "../../src/infrastructure/db/schema";
import { brands } from "../../src/infrastructure/db/schema";
import { suggestionActions } from "../../src/admin-ui/actions/suggestion";
import { BrandSuggestionService } from "../../src/domain/suggestions";

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
    CREATE TABLE brand_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      suggested_brand_name TEXT NOT NULL,
      suggested_slug TEXT NOT NULL,
      suggested_url TEXT,
      source TEXT NOT NULL,
      source_subreddit TEXT,
      source_post_url TEXT,
      source_post_title TEXT,
      source_context TEXT,
      plus_size_priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      suggested_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      resolved_brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
      resolution_note TEXT,
      rejection_reason TEXT
    );
    CREATE UNIQUE INDEX brand_suggestions_pending_slug_unique ON brand_suggestions(suggested_slug, status);
  `);
  return drizzle(sqlite, { schema });
}

const SUGGESTION_BASE = {
  suggestedBrandName: "Path Projects",
  suggestedSlug: "path-projects",
  sourceSubreddit: "running",
  sourcePostUrl: "https://reddit.com/r/running/comments/abc123/best_running_gear",
  sourcePostTitle: "Best running gear?",
};

describe("suggestionActions", () => {
  let db: ReturnType<typeof makeDb>;
  let app: AnyElysia;
  let service: BrandSuggestionService;

  beforeEach(() => {
    db = makeDb();
    app = new Elysia().use(suggestionActions({ db }));
    service = new BrandSuggestionService(db);
  });

  // Accept happy path
  test("POST /accept with valid URL: 302 redirect to brand page, brand created, suggestion accepted", async () => {
    const id = await service.create(SUGGESTION_BASE);

    const form = new FormData();
    form.set("primaryUrl", "https://pathprojects.com");

    const r = await app.handle(
      new Request(`http://localhost/admin/suggestions/${String(id)}/accept`, {
        method: "POST",
        body: form,
      })
    );

    expect(r.status).toBe(302);
    const location = r.headers.get("location") ?? "";
    expect(location).toMatch(/^\/admin\/brands\//);

    // Brand row created
    const allBrands = await db.select().from(brands);
    expect(allBrands.length).toBe(1);
    expect(allBrands[0]?.primaryUrl).toBe("https://pathprojects.com");

    // Suggestion status=accepted + resolved_brand_id set
    const sugg = await service.findById(id);
    expect(sugg?.status).toBe("accepted");
    expect(sugg?.resolvedBrandId).toBe(allBrands[0]?.id);
  });

  // Accept with invalid URL
  test("POST /accept with invalid URL: 400", async () => {
    const id = await service.create(SUGGESTION_BASE);

    const form = new FormData();
    form.set("primaryUrl", "not-a-url");

    const r = await app.handle(
      new Request(`http://localhost/admin/suggestions/${String(id)}/accept`, {
        method: "POST",
        body: form,
      })
    );

    expect(r.status).toBe(400);
  });

  // Accept for already-accepted suggestion
  test("POST /accept for already-accepted suggestion: 400 with message", async () => {
    const id = await service.create(SUGGESTION_BASE);
    // Accept it once
    await service.accept({ id, primaryUrl: "https://pathprojects.com" });

    const form = new FormData();
    form.set("primaryUrl", "https://pathprojects.com");

    const r = await app.handle(
      new Request(`http://localhost/admin/suggestions/${String(id)}/accept`, {
        method: "POST",
        body: form,
      })
    );

    expect(r.status).toBe(400);
    const body = await r.text();
    expect(body).toContain("not pending");
  });

  // Reject happy path
  test("POST /reject with reason: status=rejected, reason stored, 302 to /admin/suggestions", async () => {
    const id = await service.create(SUGGESTION_BASE);

    const form = new FormData();
    form.set("reason", "Already tracked under different brand");

    const r = await app.handle(
      new Request(`http://localhost/admin/suggestions/${String(id)}/reject`, {
        method: "POST",
        body: form,
      })
    );

    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/admin/suggestions");

    const sugg = await service.findById(id);
    expect(sugg?.status).toBe("rejected");
    expect(sugg?.rejectionReason).toBe("Already tracked under different brand");
  });

  // Reject without reason
  test("POST /reject without reason: 400", async () => {
    const id = await service.create(SUGGESTION_BASE);

    const form = new FormData();
    // intentionally omit "reason"

    const r = await app.handle(
      new Request(`http://localhost/admin/suggestions/${String(id)}/reject`, {
        method: "POST",
        body: form,
      })
    );

    expect(r.status).toBe(400);
  });
});
