import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import { Queue, registerHandler, clearHandlers } from "../../src/infrastructure/queue";
import { QueueRunner } from "../../src/infrastructure/queue/runner";

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
  return drizzle(sqlite, { schema });
}

describe("QueueRunner", () => {
  let runner: QueueRunner;
  let queue: Queue;

  beforeEach(() => {
    clearHandlers();
    const db = makeDb();
    queue = new Queue(db);
    runner = new QueueRunner({ queue, pollIntervalMs: 100, heartbeatIntervalSecs: 30 });
  });

  afterEach(() => {
    runner.stop();
  });

  test("processes a job when one is enqueued", async () => {
    const called: number[] = [];
    registerHandler("test", (payload) => {
      called.push(payload.x as number);
      return Promise.resolve();
    });
    runner.start();
    await queue.enqueue({ jobType: "test", payload: { x: 42 }, dedupeKey: "k1" });
    await new Promise((r) => setTimeout(r, 250));
    expect(called).toEqual([42]);
  });

  test("marks job failed_dead when handler throws beyond retries", async () => {
    registerHandler("boom", () => Promise.reject(new Error("nope")));
    runner.start();
    const id = await queue.enqueue({
      jobType: "boom",
      payload: {},
      dedupeKey: "k1",
      maxAttempts: 1,
    });
    await new Promise((r) => setTimeout(r, 250));
    const job = await queue.findById(id);
    expect(job?.status).toBe("failed_dead");
  });

  test("wake() causes immediate poll", async () => {
    const called: number[] = [];
    registerHandler("test", (payload) => {
      called.push((payload.x as number | undefined) ?? 0);
      return Promise.resolve();
    });
    runner.start();
    await queue.enqueue({ jobType: "test", payload: {}, dedupeKey: "k1" });
    runner.wake();
    await new Promise((r) => setTimeout(r, 50));
    expect(called.length).toBe(1);
  });
});
