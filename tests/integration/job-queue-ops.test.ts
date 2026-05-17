import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import { Queue } from "../../src/infrastructure/queue/queue";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.run(`
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      scheduled_for TEXT NOT NULL DEFAULT (datetime('now')),
      picked_at TEXT,
      heartbeat_at TEXT,
      heartbeat_interval_secs INTEGER,
      finished_at TEXT,
      error_json TEXT,
      run_id INTEGER
    );
  `);
  return drizzle(sqlite, { schema });
}

describe("Queue", () => {
  let queue: Queue;
  beforeEach(() => {
    queue = new Queue(makeDb());
  });

  test("enqueue inserts a pending job", async () => {
    const id = await queue.enqueue({
      jobType: "extract-brand-source",
      payload: { sourceId: 1 },
      dedupeKey: "extract:1",
    });
    expect(id).toBeGreaterThan(0);
    const job = await queue.findById(id);
    expect(job?.status).toBe("pending");
  });

  test("enqueue is idempotent on dedupe key", async () => {
    const id1 = await queue.enqueue({ jobType: "x", payload: {}, dedupeKey: "k1" });
    const id2 = await queue.enqueue({ jobType: "x", payload: {}, dedupeKey: "k1" });
    expect(id1).toBe(id2);
  });

  test("claimNext returns oldest pending and marks running", async () => {
    await queue.enqueue({ jobType: "x", payload: {}, dedupeKey: "k1" });
    const claimed = await queue.claimNext({ heartbeatIntervalSecs: 30 });
    expect(claimed?.status).toBe("running");
    expect(claimed?.pickedAt).not.toBeNull();
  });

  test("claimNext returns null when no work due", async () => {
    const claimed = await queue.claimNext({ heartbeatIntervalSecs: 30 });
    expect(claimed).toBeNull();
  });

  test("finish marks succeeded", async () => {
    await queue.enqueue({ jobType: "x", payload: {}, dedupeKey: "k1" });
    const claimed = await queue.claimNext({ heartbeatIntervalSecs: 30 });
    if (!claimed) throw new Error("Expected a claimed job");
    await queue.finish(claimed.id);
    const job = await queue.findById(claimed.id);
    expect(job?.status).toBe("succeeded");
    expect(job?.finishedAt).not.toBeNull();
  });

  test("fail with retries available returns to pending with backoff", async () => {
    await queue.enqueue({ jobType: "x", payload: {}, dedupeKey: "k1", maxAttempts: 3 });
    const claimed = await queue.claimNext({ heartbeatIntervalSecs: 30 });
    if (!claimed) throw new Error("Expected a claimed job");
    await queue.fail(claimed.id, new Error("boom"));
    const job = await queue.findById(claimed.id);
    expect(job?.status).toBe("pending");
    expect(job?.attempts).toBe(1);
  });

  test("fail at max attempts becomes failed_dead", async () => {
    await queue.enqueue({ jobType: "x", payload: {}, dedupeKey: "k1", maxAttempts: 1 });
    const claimed = await queue.claimNext({ heartbeatIntervalSecs: 30 });
    if (!claimed) throw new Error("Expected a claimed job");
    await queue.fail(claimed.id, new Error("boom"));
    const job = await queue.findById(claimed.id);
    expect(job?.status).toBe("failed_dead");
  });

  test("heartbeat updates heartbeat_at", async () => {
    await queue.enqueue({ jobType: "x", payload: {}, dedupeKey: "k1" });
    const claimed = await queue.claimNext({ heartbeatIntervalSecs: 30 });
    if (!claimed) throw new Error("Expected a claimed job");
    const before = claimed.heartbeatAt;
    await new Promise((r) => setTimeout(r, 1100));
    await queue.heartbeat(claimed.id);
    const job = await queue.findById(claimed.id);
    expect(job?.heartbeatAt).not.toBe(before);
  });
});
