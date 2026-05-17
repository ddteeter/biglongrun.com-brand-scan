import { describe, test, expect } from "bun:test";
import { CanonicalSizeChartSchema, parseCanonical } from "../../src/domain/extraction/canonical";

describe("canonical size chart", () => {
  test("accepts a valid chart", () => {
    const result = parseCanonical({
      source_url: "https://x.com/size",
      extracted_at: "2026-05-16T12:00:00Z",
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
    });
    expect(result.size_labels).toHaveLength(3);
  });

  test("rejects measurement missing required keys", () => {
    expect(() =>
      parseCanonical({
        source_url: "https://x.com/size",
        extracted_at: "2026-05-16T12:00:00Z",
        method: "claude",
        size_labels: ["S"],
        measurements: { S: { chest_in: [36, 38] } },
        size_availability: [],
        gender_specific: false,
      })
    ).toThrow();
  });

  test("schema accepts all gender_specific values", () => {
    const base = {
      source_url: "https://x.com",
      extracted_at: "2026-05-16T00:00:00Z",
      method: "deterministic" as const,
      size_labels: [],
      measurements: {},
      size_availability: [],
    };
    expect(() => CanonicalSizeChartSchema.parse({ ...base, gender_specific: false })).not.toThrow();
    expect(() => CanonicalSizeChartSchema.parse({ ...base, gender_specific: "men" })).not.toThrow();
    expect(() =>
      CanonicalSizeChartSchema.parse({ ...base, gender_specific: "women" })
    ).not.toThrow();
    expect(() =>
      CanonicalSizeChartSchema.parse({ ...base, gender_specific: "unisex" })
    ).not.toThrow();
  });
});
