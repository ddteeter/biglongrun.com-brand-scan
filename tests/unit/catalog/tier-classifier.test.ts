import { describe, test, expect } from "bun:test";
import {
  classifyByPricePercentile,
  computeBuckets,
  type TierBuckets,
} from "../../../src/domain/catalog/tier-classifier";

describe("classifyByPricePercentile", () => {
  test("returns unclassified when item has no price", () => {
    expect(classifyByPricePercentile(null, [50, 75, 100, 150, 200])).toEqual({
      tier: "unclassified",
      reason: "no price",
    });
  });

  test("returns unclassified when cohort has <4 priced items", () => {
    expect(classifyByPricePercentile(120, [50, 75])).toEqual({
      tier: "unclassified",
      reason: "cohort too small",
    });
  });

  test("classifies top 25% as flagship", () => {
    const cohort = [50, 75, 100, 120, 150, 200, 250];
    expect(classifyByPricePercentile(250, cohort).tier).toBe("flagship");
    expect(classifyByPricePercentile(200, cohort).tier).toBe("flagship");
  });

  test("classifies bottom 25% as basic", () => {
    const cohort = [50, 75, 100, 120, 150, 200, 250];
    expect(classifyByPricePercentile(50, cohort).tier).toBe("basic");
    expect(classifyByPricePercentile(75, cohort).tier).toBe("basic");
  });

  test("classifies middle 50% as mid", () => {
    const cohort = [50, 75, 100, 120, 150, 200, 250];
    expect(classifyByPricePercentile(120, cohort).tier).toBe("mid");
  });

  test("computeBuckets exposes the bucket thresholds for inspection", () => {
    const cohort = [50, 75, 100, 120, 150, 200, 250];
    const buckets: TierBuckets | null = computeBuckets(cohort);
    if (!buckets) throw new Error("expected buckets");
    expect(buckets.flagshipMin).toBeGreaterThan(buckets.basicMax);
    expect(buckets.cohortSize).toBe(7);
  });
});
