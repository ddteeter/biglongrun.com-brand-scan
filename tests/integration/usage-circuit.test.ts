import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/infrastructure/db/schema";
import { UsageTracker, CircuitBreaker } from "../../src/domain/usage";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.run(`
    CREATE TABLE api_usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      run_id INTEGER,
      units_used REAL NOT NULL,
      units_kind TEXT NOT NULL,
      estimated_cost_usd REAL NOT NULL,
      occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return drizzle(sqlite, { schema });
}

describe("usage tracker + circuit breaker", () => {
  test("tracks pages and computes warn at 75%", async () => {
    const db = makeDb();
    const tracker = new UsageTracker(db);
    for (let i = 0; i < 8; i++) {
      await tracker.record({
        provider: "firecrawl",
        unitsUsed: 100,
        unitsKind: "pages",
        estimatedCostUsd: 0,
      });
    }
    const breaker = new CircuitBreaker(db, {
      firecrawlMonthlyPages: 1000,
      anthropicMonthlyUsd: 10,
    });
    const check = await breaker.check("firecrawl");
    expect(check.used).toBe(800);
    expect(check.status).toBe("warn");
  });

  test("returns exceeded at 100%", async () => {
    const db = makeDb();
    const tracker = new UsageTracker(db);
    await tracker.record({
      provider: "anthropic",
      unitsUsed: 1,
      unitsKind: "messages",
      estimatedCostUsd: 10,
    });
    const breaker = new CircuitBreaker(db, {
      firecrawlMonthlyPages: 1000,
      anthropicMonthlyUsd: 10,
    });
    const check = await breaker.check("anthropic");
    expect(check.status).toBe("exceeded");
  });
});
