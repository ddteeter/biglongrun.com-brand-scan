import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { jobs } from "../../src/infrastructure/db/schema/ops";

describe("ops schema", () => {
  let db: ReturnType<typeof drizzle>;
  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.run(`
      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_type TEXT NOT NULL,
        payload_json TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','failed_dead')),
        attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
        scheduled_for TEXT NOT NULL DEFAULT (datetime('now')),
        picked_at TEXT, heartbeat_at TEXT, heartbeat_interval_secs INTEGER,
        finished_at TEXT, error_json TEXT, run_id INTEGER
      );
      CREATE TABLE runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT, status TEXT NOT NULL, summary_json TEXT,
        cost_usd_estimate REAL, firecrawl_pages_used INTEGER
      );
      CREATE TABLE run_artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('screenshot','raw_html','raw_claude_response')),
        file_path TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE api_usage_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL CHECK (provider IN ('firecrawl','anthropic','pushover')),
        run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
        units_used REAL NOT NULL, units_kind TEXT NOT NULL,
        estimated_cost_usd REAL NOT NULL,
        occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db = drizzle(sqlite);
  });

  test("inserts a job with a unique dedupe key", async () => {
    const [j] = await db
      .insert(jobs)
      .values({
        jobType: "extract-brand-source",
        payloadJson: { brandSourceId: 1 },
        dedupeKey: "extract-brand-source:1",
        status: "pending",
      })
      .returning();
    expect(j?.status).toBe("pending");
    expect(() => {
      db.insert(jobs)
        .values({
          jobType: "extract-brand-source",
          payloadJson: {},
          dedupeKey: "extract-brand-source:1",
          status: "pending",
        })
        .run();
    }).toThrow();
  });
});
