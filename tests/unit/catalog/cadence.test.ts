import { describe, test, expect } from "bun:test";
import { computeBrandCadence } from "../../../src/domain/catalog/cadence";

const DAY_MS = 86_400_000;
const BASE = new Date("2026-01-01T00:00:00Z").getTime();

function daysAgo(n: number): string {
  return new Date(BASE + n * DAY_MS).toISOString();
}

const now = new Date("2026-05-16T00:00:00Z");

describe("computeBrandCadence", () => {
  test("fewer than 3 dates → null prediction with correct reason", () => {
    const result = computeBrandCadence({ acceptedChangeDates: [daysAgo(0), daysAgo(30)] }, now);
    expect(result.predictedNextChangeAt).toBeNull();
    expect(result.medianDays).toBeNull();
    expect(result.coefficientOfVariation).toBeNull();
    expect(result.intervals).toEqual([]);
    expect(result.reason).toBe("fewer than 3 observed changes");
  });

  test("0 dates → fewer than 3 reason", () => {
    const result = computeBrandCadence({ acceptedChangeDates: [] }, now);
    expect(result.predictedNextChangeAt).toBeNull();
    expect(result.reason).toBe("fewer than 3 observed changes");
  });

  test("stable cadence → predicts next change minus 7-day safety buffer", () => {
    // 4 dates ~30 days apart: intervals [30, 30, 30], median=30, cv=0
    const dates = [daysAgo(0), daysAgo(30), daysAgo(60), daysAgo(90)];
    const result = computeBrandCadence({ acceptedChangeDates: dates }, now);
    expect(result.predictedNextChangeAt).not.toBeNull();
    expect(result.medianDays).toBe(30);
    // predicted = lastChange + (30 - 7) days = daysAgo(90) + 23 days = daysAgo(67)
    const lastChange = new Date(daysAgo(90)).getTime();
    const expected = new Date(lastChange + 23 * DAY_MS).toISOString();
    expect(result.predictedNextChangeAt).toBe(expected);
    expect(result.reason).toContain("low variance");
  });

  test("intervals computed correctly — 4 dates produce 3 intervals", () => {
    const dates = [daysAgo(0), daysAgo(30), daysAgo(60), daysAgo(90)];
    const result = computeBrandCadence({ acceptedChangeDates: dates }, now);
    expect(result.intervals).toHaveLength(3);
    expect(result.intervals[0]).toBe(30);
    expect(result.intervals[1]).toBe(30);
    expect(result.intervals[2]).toBe(30);
  });

  test("high variance dates → null prediction", () => {
    // Intervals: 1, 200, 5 → highly irregular
    const t0 = BASE;
    const t1 = t0 + 1 * DAY_MS;
    const t2 = t1 + 200 * DAY_MS;
    const t3 = t2 + 5 * DAY_MS;
    const dates = [t0, t1, t2, t3].map((t) => new Date(t).toISOString());
    const result = computeBrandCadence({ acceptedChangeDates: dates }, now);
    expect(result.predictedNextChangeAt).toBeNull();
    expect(result.reason).toContain("high variance");
  });

  test("3 dates → 2 intervals", () => {
    const dates = [daysAgo(0), daysAgo(28), daysAgo(56)];
    const result = computeBrandCadence({ acceptedChangeDates: dates }, now);
    expect(result.intervals).toHaveLength(2);
    expect(result.intervals[0]).toBe(28);
    expect(result.intervals[1]).toBe(28);
  });

  test("cv exactly 0 → low variance path taken", () => {
    const dates = [daysAgo(0), daysAgo(30), daysAgo(60), daysAgo(90)];
    const result = computeBrandCadence({ acceptedChangeDates: dates }, now);
    expect(result.coefficientOfVariation).toBe(0);
    expect(result.predictedNextChangeAt).not.toBeNull();
  });
});
