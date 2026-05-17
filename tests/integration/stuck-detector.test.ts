import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import { Queue } from "../../src/infrastructure/queue";
import { detectStuckJobs } from "../../src/infrastructure/queue/stuck-detector";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.run(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL, payload_json TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
      scheduled_for TEXT NOT NULL DEFAULT (datetime('now')),
      picked_at TEXT, heartbeat_at TEXT, heartbeat_interval_secs INTEGER,
      finished_at TEXT, error_json TEXT, run_id INTEGER
    );
  `);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

describe("detectStuckJobs", () => {
  let sqlite: Database;
  let db: ReturnType<typeof makeDb>["db"];
  let queue: Queue;

  beforeEach(() => {
    const made = makeDb();
    sqlite = made.sqlite;
    db = made.db;
    queue = new Queue(db);
  });

  test("resets a running job with stale heartbeat to pending", async () => {
    await queue.enqueue({ jobType: "x", payload: {}, dedupeKey: "k1", maxAttempts: 3 });
    const claimed = await queue.claimNext({ heartbeatIntervalSecs: 30 });
    if (!claimed) throw new Error("Expected a claimed job");
    // Simulate stale heartbeat (3x interval = 90s ago)
    const stale = new Date(Date.now() - 91_000).toISOString();
    sqlite.run(`UPDATE jobs SET heartbeat_at='${stale}' WHERE id=${String(claimed.id)}`);

    const result = await detectStuckJobs({ db, now: () => new Date() });

    expect(result.reset).toContain(claimed.id);
    const job = await queue.findById(claimed.id);
    expect(job?.status).toBe("pending");
    expect(job?.attempts).toBe(1);
  });

  test("does not reset jobs with fresh heartbeat", async () => {
    await queue.enqueue({ jobType: "x", payload: {}, dedupeKey: "k1" });
    await queue.claimNext({ heartbeatIntervalSecs: 30 });
    const result = await detectStuckJobs({ db, now: () => new Date() });
    expect(result.reset).toEqual([]);
  });

  test("marks failed_dead if attempts exhausted", async () => {
    await queue.enqueue({ jobType: "x", payload: {}, dedupeKey: "k1", maxAttempts: 1 });
    const claimed = await queue.claimNext({ heartbeatIntervalSecs: 30 });
    if (!claimed) throw new Error("Expected a claimed job");
    const stale = new Date(Date.now() - 91_000).toISOString();
    sqlite.run(`UPDATE jobs SET heartbeat_at='${stale}' WHERE id=${String(claimed.id)}`);
    await detectStuckJobs({ db, now: () => new Date() });
    const job = await queue.findById(claimed.id);
    expect(job?.status).toBe("failed_dead");
  });
});
