import { describe, test, expect } from "bun:test";
import { scoreBreadth } from "../../src/domain/scoring/breadth";
import { scoreAccuracy } from "../../src/domain/scoring/accuracy";
import { computeComposite } from "../../src/domain/scoring/composite";
import { WEIGHTS } from "../../src/domain/scoring/config";
import type { CohortSummaryJson } from "../../src/domain/scoring/cohort";
import type { CanonicalSizeChart } from "../../src/domain/extraction";

const cohort: CohortSummaryJson = {
  perSize: {
    S: {
      chestMedian: 36,
      waistMedian: 28,
      hipMedian: 36,
      chestStdDev: 1,
      waistStdDev: 1,
      hipStdDev: 1,
    },
    M: {
      chestMedian: 38,
      waistMedian: 30,
      hipMedian: 38,
      chestStdDev: 1,
      waistStdDev: 1,
      hipStdDev: 1,
    },
    L: {
      chestMedian: 40,
      waistMedian: 32,
      hipMedian: 40,
      chestStdDev: 1,
      waistStdDev: 1,
      hipStdDev: 1,
    },
  },
  breadths: [3, 4, 5, 6, 7],
  breadthMedian: 5,
  breadthMin: 3,
  breadthMax: 7,
};

const wideBrand: CanonicalSizeChart = {
  source_url: "x",
  extracted_at: "x",
  method: "claude",
  size_availability: [],
  notes: "",
  gender_specific: false,
  size_labels: ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
  measurements: {
    XS: { chest_in: [34, 35], waist_in: [26, 27], hip_in: [34, 35] },
    S: { chest_in: [36, 37], waist_in: [28, 29], hip_in: [36, 37] },
    M: { chest_in: [38, 39], waist_in: [30, 31], hip_in: [38, 39] },
    L: { chest_in: [40, 41], waist_in: [32, 33], hip_in: [40, 41] },
    XL: { chest_in: [42, 43], waist_in: [34, 35], hip_in: [42, 43] },
    "2XL": { chest_in: [44, 45], waist_in: [36, 37], hip_in: [44, 45] },
    "3XL": { chest_in: [46, 47], waist_in: [38, 39], hip_in: [46, 47] },
  },
};

const narrowBrand: CanonicalSizeChart = {
  source_url: "y",
  extracted_at: "y",
  method: "claude",
  size_availability: [],
  notes: "",
  gender_specific: false,
  size_labels: ["S", "M", "L"],
  measurements: {
    S: { chest_in: [36, 37], waist_in: [28, 29], hip_in: [36, 37] },
    M: { chest_in: [38, 39], waist_in: [30, 31], hip_in: [38, 39] },
    L: { chest_in: [40, 41], waist_in: [32, 33], hip_in: [40, 41] },
  },
};

describe("scoreBreadth", () => {
  test("wide brand at cohort max scores 10", () => {
    expect(scoreBreadth(wideBrand, cohort)).toBeCloseTo(10);
  });

  test("narrow brand at cohort min scores 0", () => {
    expect(scoreBreadth(narrowBrand, cohort)).toBeCloseTo(0);
  });

  test("cohort median brand scores 5", () => {
    const medianBrand: CanonicalSizeChart = {
      ...narrowBrand,
      size_labels: ["S", "M", "L", "XL", "2XL"],
      measurements: {
        S: { chest_in: [36, 37], waist_in: [28, 29], hip_in: [36, 37] },
        M: { chest_in: [38, 39], waist_in: [30, 31], hip_in: [38, 39] },
        L: { chest_in: [40, 41], waist_in: [32, 33], hip_in: [40, 41] },
        XL: { chest_in: [42, 43], waist_in: [34, 35], hip_in: [42, 43] },
        "2XL": { chest_in: [44, 45], waist_in: [36, 37], hip_in: [44, 45] },
      },
    };
    expect(scoreBreadth(medianBrand, cohort)).toBeCloseTo(5);
  });
});

describe("scoreAccuracy", () => {
  test("brand exactly matching cohort medians scores 10", () => {
    const exact: CanonicalSizeChart = {
      source_url: "z",
      extracted_at: "z",
      method: "claude",
      size_availability: [],
      notes: "",
      gender_specific: false,
      size_labels: ["S", "M", "L"],
      measurements: {
        S: { chest_in: [36, 36], waist_in: [28, 28], hip_in: [36, 36] },
        M: { chest_in: [38, 38], waist_in: [30, 30], hip_in: [38, 38] },
        L: { chest_in: [40, 40], waist_in: [32, 32], hip_in: [40, 40] },
      },
    };
    expect(scoreAccuracy(exact, cohort)).toBeCloseTo(10);
  });

  test("brand 5 inches off scores lower", () => {
    const off: CanonicalSizeChart = {
      source_url: "z",
      extracted_at: "z",
      method: "claude",
      size_availability: [],
      notes: "",
      gender_specific: false,
      size_labels: ["S"],
      measurements: { S: { chest_in: [41, 41], waist_in: [33, 33], hip_in: [41, 41] } },
    };
    expect(scoreAccuracy(off, cohort)).toBeLessThan(8);
  });
});

describe("computeComposite", () => {
  test("normalized weighted average drops null dimensions", () => {
    const r = computeComposite({
      size_range_breadth: 8,
      measurement_accuracy: 6,
      range_parity: null,
      pricing_equity: null,
      colorway_equity: null,
    });
    // weights for the two = 0.25 + 0.20 = 0.45
    // weighted sum = 0.25*8 + 0.20*6 = 2 + 1.2 = 3.2
    // composite = 3.2 / 0.45 ≈ 7.11
    expect(r).toBeCloseTo(3.2 / 0.45);
  });

  test("with all five dimensions yields a normal weighted average", () => {
    const r = computeComposite({
      size_range_breadth: 10,
      measurement_accuracy: 10,
      range_parity: 10,
      pricing_equity: 10,
      colorway_equity: 10,
    });
    expect(r).toBeCloseTo(10);
  });

  test("returns null when all dimensions are null", () => {
    expect(
      computeComposite({
        size_range_breadth: null,
        measurement_accuracy: null,
        range_parity: null,
        pricing_equity: null,
        colorway_equity: null,
      })
    ).toBeNull();
  });
});

// Ensure WEIGHTS is imported and accessible (used to compute expected values above)
test("WEIGHTS sums to 1.0", () => {
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  expect(total).toBeCloseTo(1);
});
