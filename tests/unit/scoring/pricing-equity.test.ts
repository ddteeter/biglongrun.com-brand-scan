import { describe, test, expect } from "bun:test";
import { scorePricingEquity } from "../../../src/domain/scoring/pricing-equity";
import { makeItem, type BrandItem } from "./helpers";

describe("scorePricingEquity", () => {
  test("perfect equity (all sizes same price) → 10", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        perSizeDataJson: {
          S: { available: true, price: 30 },
          M: { available: true, price: 30 },
          L: { available: true, price: 30 },
          XXL: { available: true, price: 30 },
          "2XL": { available: true, price: 30 },
        },
      }),
      makeItem({
        id: 2,
        perSizeDataJson: {
          XS: { available: true, price: 50 },
          S: { available: true, price: 50 },
          M: { available: true, price: 50 },
          L: { available: true, price: 50 },
          XXL: { available: true, price: 50 },
        },
      }),
    ];

    const score = scorePricingEquity(items);
    expect(score).toBeCloseTo(10);
  });

  test("uniform 20% upcharge on extended → ~6", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        perSizeDataJson: {
          S: { available: true, price: 50 },
          M: { available: true, price: 50 },
          L: { available: true, price: 50 },
          XXL: { available: true, price: 60 }, // 20% upcharge
          "2XL": { available: true, price: 60 },
        },
      }),
    ];

    // ratio = 60/50 = 1.2, score = 10 - (1.2-1)*20 = 10 - 4 = 6
    const score = scorePricingEquity(items);
    expect(score).toBeCloseTo(6);
  });

  test("no extended sizes available → 5 (neutral)", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        perSizeDataJson: {
          S: { available: true, price: 40 },
          M: { available: true, price: 40 },
          L: { available: true, price: 40 },
        },
      }),
    ];

    const score = scorePricingEquity(items);
    expect(score).toBe(5);
  });

  test("empty items → 5 (neutral)", () => {
    expect(scorePricingEquity([])).toBe(5);
  });

  test("all discontinued items → 5 (neutral)", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        isDiscontinued: true,
        perSizeDataJson: {
          S: { available: true, price: 40 },
          XXL: { available: true, price: 50 },
        },
      }),
    ];

    expect(scorePricingEquity(items)).toBe(5);
  });

  test("50% upcharge → 0 (clamped)", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        perSizeDataJson: {
          S: { available: true, price: 40 },
          M: { available: true, price: 40 },
          XXL: { available: true, price: 60 }, // 50% upcharge
        },
      }),
    ];

    // ratio = 60/40 = 1.5, score = 10 - (1.5-1)*20 = 10 - 10 = 0
    const score = scorePricingEquity(items);
    expect(score).toBeCloseTo(0);
  });

  test("skips items where extended price not available (available !== true)", () => {
    // This item has extended sizes but not available, so should be skipped → neutral
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        perSizeDataJson: {
          S: { available: true, price: 40 },
          XXL: { available: false, price: 60 }, // not available, should be skipped
        },
      }),
    ];

    expect(scorePricingEquity(items)).toBe(5);
  });
});
