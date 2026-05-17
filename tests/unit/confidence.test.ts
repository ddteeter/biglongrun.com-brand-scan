import { describe, test, expect } from "bun:test";
import { compositeConfidence, type ConfidenceInputs } from "../../src/domain/extraction/confidence";

describe("compositeConfidence", () => {
  const base: ConfidenceInputs = {
    claudeReported: 0.9,
    structuralValidation: 1,
    cohortOutlier: 1,
  };

  test("multiplies the three factors", () => {
    expect(compositeConfidence({ ...base, claudeReported: 0.5 }).composite).toBeCloseTo(0.5);
    expect(compositeConfidence({ ...base, structuralValidation: 0.5 }).composite).toBeCloseTo(0.45);
  });

  test("clamps to [0,1]", () => {
    const r = compositeConfidence({
      claudeReported: 1.2,
      structuralValidation: 1.2,
      cohortOutlier: 1.2,
    });
    expect(r.composite).toBe(1);
  });

  test("breakdown carries inputs as-is", () => {
    const r = compositeConfidence(base);
    expect(r.breakdown).toEqual(base);
  });
});
