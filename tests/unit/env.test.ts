import { describe, test, expect } from "bun:test";
import { parseEnv } from "../../src/env";

describe("env", () => {
  test("parses a full valid env", () => {
    const env = parseEnv({
      ANTHROPIC_API_KEY: "x",
      FIRECRAWL_API_KEY: "x",
      PUSHOVER_USER_KEY: "x",
      PUSHOVER_APP_TOKEN: "x",
      BLOG_API_TOKEN: "x".repeat(16),
      ADMIN_PASSWORD_HASH: "$argon2id$...",
      SESSION_SECRET: "0".repeat(32),
      DATABASE_PATH: "./tmp/db.sqlite",
      ARTIFACTS_PATH: "./tmp/artifacts",
      PUBLIC_BASE_URL: "http://localhost:3000",
      FIRECRAWL_MONTHLY_PAGE_BUDGET: "1000",
      ANTHROPIC_MONTHLY_USD_BUDGET: "10",
      BUN_ENV: "development",
      USE_REAL_APIS: "0",
    });
    expect(env.FIRECRAWL_MONTHLY_PAGE_BUDGET).toBe(1000);
    expect(env.ANTHROPIC_MONTHLY_USD_BUDGET).toBe(10);
    expect(env.USE_REAL_APIS).toBe(false);
  });

  test("rejects short SESSION_SECRET", () => {
    const bad = { SESSION_SECRET: "tooshort" } as unknown as Record<string, string | undefined>;
    expect(() => parseEnv(bad)).toThrow();
  });
});
