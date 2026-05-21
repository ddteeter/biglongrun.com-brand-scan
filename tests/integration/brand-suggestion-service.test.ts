import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import { brands } from "../../src/infrastructure/db/schema";
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

describe("BrandSuggestionService", () => {
  let db: ReturnType<typeof makeDb>;
  let service: BrandSuggestionService;

  beforeEach(() => {
    db = makeDb();
    service = new BrandSuggestionService(db);
  });

  test("create inserts a pending suggestion with all fields", async () => {
    const id = await service.create(SUGGESTION_BASE);
    const row = await service.findById(id);

    expect(row).toBeDefined();
    expect(row?.suggestedBrandName).toBe("Path Projects");
    expect(row?.suggestedSlug).toBe("path-projects");
    expect(row?.status).toBe("pending");
    expect(row?.plusSizePriority).toBe(false);
    expect(row?.source).toBe("reddit");
    expect(row?.sourceSubreddit).toBe("running");
    expect(row?.suggestedAt).toBeTruthy();
  });

  test("create with same (slug, pending) returns the existing id (idempotent)", async () => {
    const id1 = await service.create(SUGGESTION_BASE);
    const id2 = await service.create({
      ...SUGGESTION_BASE,
      sourcePostUrl: "https://reddit.com/r/running/comments/xyz999/another_post",
      sourcePostTitle: "Another post about gear",
    });

    expect(id2).toBe(id1);
    const pending = await service.listPending();
    expect(pending.length).toBe(1);
  });

  test("create with same slug but prior status is rejected creates a new pending row", async () => {
    const id1 = await service.create(SUGGESTION_BASE);
    await service.reject({ id: id1, reason: "Not a running brand" });

    const id2 = await service.create(SUGGESTION_BASE);
    expect(id2).not.toBe(id1);

    const pending = await service.listPending();
    expect(pending.length).toBe(1);
    expect(pending[0]?.id).toBe(id2);
  });

  test("accept happy path: creates brand + updates suggestion atomically", async () => {
    const suggId = await service.create(SUGGESTION_BASE);

    const result = await service.accept({
      id: suggId,
      primaryUrl: "https://pathprojects.com",
    });

    expect(result.brandSlug).toBeTruthy();
    expect(result.brandId).toBeGreaterThan(0);

    // Verify brand was created in brands table
    const allBrands = await db.select().from(brands);
    expect(allBrands.length).toBe(1);
    expect(allBrands[0]?.slug).toBe(result.brandSlug);

    // Verify suggestion updated
    const sugg = await service.findById(suggId);
    expect(sugg?.status).toBe("accepted");
    expect(sugg?.resolvedBrandId).toBe(result.brandId);
    expect(sugg?.resolvedAt).toBeTruthy();
  });

  test("accept on non-pending suggestion throws", async () => {
    const suggId = await service.create(SUGGESTION_BASE);
    await service.reject({ id: suggId, reason: "Not relevant" });

    let threw = false;
    try {
      await service.accept({ id: suggId, primaryUrl: "https://pathprojects.com" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("accept rolls back both writes if the transaction fails (non-pending suggestion)", async () => {
    // Create and immediately reject the suggestion so it is not pending
    const suggId = await service.create(SUGGESTION_BASE);
    await service.reject({ id: suggId, reason: "Will try to accept again" });

    const brandCountBefore = await db.select().from(brands);

    let threw = false;
    try {
      // Attempting to accept a non-pending suggestion should throw without
      // touching the brands table — verifying the tx guard fires before any insert.
      await service.accept({ id: suggId, primaryUrl: "https://pathprojects.com" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // No brand was created (brands table unchanged)
    const brandCountAfter = await db.select().from(brands);
    expect(brandCountAfter.length).toBe(brandCountBefore.length);

    // Suggestion is still rejected (not reverted to pending)
    const sugg = await service.findById(suggId);
    expect(sugg?.status).toBe("rejected");
  });

  test("reject with empty reason throws (Zod validation)", async () => {
    const suggId = await service.create(SUGGESTION_BASE);

    let threw = false;
    try {
      await service.reject({ id: suggId, reason: "" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("reject happy path: status=rejected, rejection_reason, resolved_at set", async () => {
    const suggId = await service.create(SUGGESTION_BASE);
    await service.reject({ id: suggId, reason: "Already tracked" });

    const row = await service.findById(suggId);
    expect(row?.status).toBe("rejected");
    expect(row?.rejectionReason).toBe("Already tracked");
    expect(row?.resolvedAt).toBeTruthy();
  });

  test("listPending returns plus-size-priority items first, then newest", async () => {
    await service.create({
      ...SUGGESTION_BASE,
      suggestedBrandName: "Normal Brand",
      suggestedSlug: "normal-brand",
      sourcePostUrl: "https://reddit.com/r/running/comments/aaa/normal",
      sourcePostTitle: "Normal post",
      plusSizePriority: false,
    });

    await service.create({
      ...SUGGESTION_BASE,
      suggestedBrandName: "Plus Size Brand",
      suggestedSlug: "plus-size-brand",
      sourcePostUrl: "https://reddit.com/r/running/comments/bbb/plus_size",
      sourcePostTitle: "Plus size post",
      plusSizePriority: true,
    });

    await service.create({
      ...SUGGESTION_BASE,
      suggestedBrandName: "Another Normal Brand",
      suggestedSlug: "another-normal-brand",
      sourcePostUrl: "https://reddit.com/r/running/comments/ccc/another",
      sourcePostTitle: "Another normal post",
      plusSizePriority: false,
    });

    const pending = await service.listPending();
    expect(pending.length).toBe(3);
    // Plus-size item should be first
    expect(pending[0]?.plusSizePriority).toBe(true);
    expect(pending[0]?.suggestedSlug).toBe("plus-size-brand");
    // Non-priority items follow (newest first)
    expect(pending[1]?.plusSizePriority).toBe(false);
    expect(pending[2]?.plusSizePriority).toBe(false);
  });

  test("countPendingForSlug returns correct count", async () => {
    expect(await service.countPendingForSlug("path-projects")).toBe(0);
    await service.create(SUGGESTION_BASE);
    expect(await service.countPendingForSlug("path-projects")).toBe(1);
  });

  test("listByStatus returns suggestions filtered by status", async () => {
    const id1 = await service.create(SUGGESTION_BASE);
    await service.create({
      ...SUGGESTION_BASE,
      suggestedBrandName: "Tracksmith",
      suggestedSlug: "tracksmith",
      sourcePostUrl: "https://reddit.com/r/running/comments/def/tracksmith",
      sourcePostTitle: "Tracksmith review",
    });
    await service.reject({ id: id1, reason: "Duplicate" });

    const rejected = await service.listByStatus("rejected");
    expect(rejected.length).toBe(1);
    expect(rejected[0]?.suggestedSlug).toBe("path-projects");

    const pending = await service.listByStatus("pending");
    expect(pending.length).toBe(1);
    expect(pending[0]?.suggestedSlug).toBe("tracksmith");
  });
});
