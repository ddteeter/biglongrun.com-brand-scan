import { describe, test, expect } from "bun:test";
import { computeDivergence } from "../../../src/domain/assessments/divergence";
import type { AssessmentRatings } from "../../../src/domain/assessments";

const baseRatings: AssessmentRatings = {
  size_options: 7,
  tier_equity: 5,
  pricing_equity: 8,
  fit_label_honesty: 6,
  overall_inclusivity: 6,
};

describe("computeDivergence", () => {
  test("returns divergent: false and gap: null when composite is null", () => {
    const result = computeDivergence({
      composite: null,
      assessmentRatings: [baseRatings],
    });
    expect(result.divergent).toBe(false);
    expect(result.gap).toBeNull();
  });

  test("returns divergent: false and gap: null when assessmentRatings is empty", () => {
    const result = computeDivergence({
      composite: 7,
      assessmentRatings: [],
    });
    expect(result.divergent).toBe(false);
    expect(result.gap).toBeNull();
  });

  test("gap > 2.0 produces divergent: true", () => {
    // composite = 9, meanOverall = 6 → gap = 3 > threshold (2)
    const result = computeDivergence({
      composite: 9,
      assessmentRatings: [{ ...baseRatings, overall_inclusivity: 6 }],
    });
    expect(result.divergent).toBe(true);
    expect(result.gap).toBeCloseTo(3);
  });

  test("gap < 2.0 produces divergent: false", () => {
    // composite = 7, meanOverall = 6 → gap = 1 < threshold (2)
    const result = computeDivergence({
      composite: 7,
      assessmentRatings: [{ ...baseRatings, overall_inclusivity: 6 }],
    });
    expect(result.divergent).toBe(false);
    expect(result.gap).toBeCloseTo(1);
  });

  test("gap exactly at threshold (= 2.0) is not divergent", () => {
    // composite = 8, meanOverall = 6 → gap = 2 — NOT strictly greater
    const result = computeDivergence({
      composite: 8,
      assessmentRatings: [{ ...baseRatings, overall_inclusivity: 6 }],
    });
    expect(result.divergent).toBe(false);
    expect(result.gap).toBeCloseTo(2);
  });

  test("composite lower than mean is also flagged when gap > 2.0 (absolute value)", () => {
    // composite = 3, meanOverall = 6 → gap = 3 > threshold
    const result = computeDivergence({
      composite: 3,
      assessmentRatings: [{ ...baseRatings, overall_inclusivity: 6 }],
    });
    expect(result.divergent).toBe(true);
    expect(result.gap).toBeCloseTo(3);
  });

  test("averages overall_inclusivity across multiple assessments", () => {
    // mean = (4 + 6 + 8) / 3 = 6, composite = 9.5 → gap = 3.5 > 2 → divergent
    const result = computeDivergence({
      composite: 9.5,
      assessmentRatings: [
        { ...baseRatings, overall_inclusivity: 4 },
        { ...baseRatings, overall_inclusivity: 6 },
        { ...baseRatings, overall_inclusivity: 8 },
      ],
    });
    expect(result.divergent).toBe(true);
    expect(result.gap).toBeCloseTo(3.5);
  });

  test("not divergent when multiple assessments average within threshold", () => {
    // mean = (5 + 7) / 2 = 6, composite = 7 → gap = 1 < 2 → not divergent
    const result = computeDivergence({
      composite: 7,
      assessmentRatings: [
        { ...baseRatings, overall_inclusivity: 5 },
        { ...baseRatings, overall_inclusivity: 7 },
      ],
    });
    expect(result.divergent).toBe(false);
    expect(result.gap).toBeCloseTo(1);
  });
});
