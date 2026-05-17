import { describe, test, expect } from "bun:test";
import { DomainRateLimiter } from "../../src/infrastructure/external/rate-limiter";

describe("DomainRateLimiter", () => {
  test("allows first request immediately", () => {
    const rl = new DomainRateLimiter({ minIntervalMs: 30_000, now: () => 1000 });
    expect(rl.nextAvailableAt("example.com")).toBe(1000);
  });

  test("delays subsequent request to minInterval after last", () => {
    let t = 1000;
    const rl = new DomainRateLimiter({ minIntervalMs: 30_000, now: () => t });
    rl.record("example.com");
    t = 5000;
    expect(rl.nextAvailableAt("example.com")).toBe(1000 + 30_000);
  });

  test("returns now when min interval has elapsed", () => {
    let t = 1000;
    const rl = new DomainRateLimiter({ minIntervalMs: 30_000, now: () => t });
    rl.record("example.com");
    t = 50_000;
    expect(rl.nextAvailableAt("example.com")).toBe(50_000);
  });

  test("isolates buckets per hostname", () => {
    const t = 1000;
    const rl = new DomainRateLimiter({ minIntervalMs: 30_000, now: () => t });
    rl.record("a.com");
    expect(rl.nextAvailableAt("b.com")).toBe(1000);
  });

  test("extractHost normalizes", () => {
    expect(DomainRateLimiter.extractHost("https://www.Example.com/foo")).toBe("example.com");
    // Port stripping: URL parser drops non-default ports from hostname, lowercased
    expect(DomainRateLimiter.extractHost("https://x.com:443/bar")).toBe("x.com");
  });
});
