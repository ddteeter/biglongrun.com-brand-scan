import { describe, test, expect } from "bun:test";
import { createLogger } from "../../src/logger";

describe("logger", () => {
  test("redacts sensitive values", () => {
    const events: string[] = [];
    const logger = createLogger({
      level: "info",
      write: (line: string) => events.push(line),
    });
    logger.info({ anthropicApiKey: "sk-secret", brand: "x" }, "test");
    expect(events).toHaveLength(1);
    const line = events[0] ?? "";
    expect(line).toContain('"brand":"x"');
    expect(line).not.toContain("sk-secret");
    expect(line).toContain("[Redacted]");
  });
});
