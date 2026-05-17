import { describe, test, expect } from "bun:test";
import { validateStructural } from "../../src/domain/extraction/validators";
import type { CanonicalSizeChart } from "../../src/domain/extraction";

const base: CanonicalSizeChart = {
  source_url: "https://x.com/size",
  extracted_at: "2026-05-16T00:00:00Z",
  method: "claude",
  size_labels: ["S", "M", "L"],
  measurements: {
    S: { chest_in: [36, 38], waist_in: [28, 30], hip_in: [36, 38] },
    M: { chest_in: [38, 40], waist_in: [30, 32], hip_in: [38, 40] },
    L: { chest_in: [40, 42], waist_in: [32, 34], hip_in: [40, 42] },
  },
  size_availability: [],
  notes: "",
  gender_specific: false,
};

describe("validateStructural", () => {
  test("passes a well-formed chart with score 1.0", () => {
    const r = validateStructural(base);
    expect(r.score).toBe(1);
    expect(r.issues).toEqual([]);
  });

  test("flags non-monotonic measurements", () => {
    const r = validateStructural({
      ...base,
      measurements: {
        S: { chest_in: [40, 42], waist_in: [30, 32], hip_in: [40, 42] },
        M: { chest_in: [36, 38], waist_in: [28, 30], hip_in: [36, 38] },
        L: { chest_in: [38, 40], waist_in: [32, 34], hip_in: [38, 40] },
      },
    });
    expect(r.score).toBeLessThan(1);
    expect(r.issues.some((i) => i.includes("monotonic"))).toBe(true);
  });

  test("flags implausible measurements", () => {
    const r = validateStructural({
      ...base,
      measurements: {
        ...base.measurements,
        L: { chest_in: [400, 420], waist_in: [320, 340], hip_in: [400, 420] },
      },
    });
    expect(r.score).toBeLessThan(1);
    expect(r.issues.some((i) => i.includes("plausible"))).toBe(true);
  });

  test("flags chest < waist (likely transposed columns)", () => {
    const r = validateStructural({
      ...base,
      measurements: {
        S: { chest_in: [20, 22], waist_in: [28, 30], hip_in: [36, 38] },
      } as never,
      size_labels: ["S"],
    });
    expect(r.score).toBeLessThan(1);
    expect(r.issues.some((i) => i.toLowerCase().includes("chest"))).toBe(true);
  });
});
