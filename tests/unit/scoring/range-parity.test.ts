import { describe, test, expect } from "bun:test";
import { scoreRangeParity } from "../../../src/domain/scoring/range-parity";
import type { brandItems } from "../../../src/infrastructure/db/schema";

type BrandItem = typeof brandItems.$inferSelect;

function makeItem(
  overrides: Partial<BrandItem> & { perSizeDataJson: BrandItem["perSizeDataJson"] }
): BrandItem {
  return {
    id: 1,
    brandId: 1,
    externalId: null,
    sourceUrl: "https://example.com/item",
    name: "Test Item",
    category: "tops",
    tierClassification: "mid",
    tierInferredBy: null,
    tierRationale: null,
    basePriceUsd: null,
    firstSeenAt: "2024-01-01T00:00:00.000Z",
    lastVerifiedAt: "2024-01-01T00:00:00.000Z",
    isDiscontinued: false,
    discontinuedAt: null,
    ...overrides,
  };
}

describe("scoreRangeParity", () => {
  test("brand offering everything at all sizes → score 10", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        category: "tops",
        tierClassification: "flagship",
        perSizeDataJson: {
          XS: { available: true },
          S: { available: true },
          M: { available: true },
          L: { available: true },
          XL: { available: true },
          XXL: { available: true },
          "2XL": { available: true },
          "3XL": { available: true },
        },
      }),
      makeItem({
        id: 2,
        category: "bottoms",
        tierClassification: "flagship",
        perSizeDataJson: {
          XS: { available: true },
          S: { available: true },
          M: { available: true },
          L: { available: true },
          XL: { available: true },
          XXL: { available: true },
          "2XL": { available: true },
        },
      }),
    ];

    const result = scoreRangeParity(items);
    expect(result.score).toBeCloseTo(10);
    expect(result.categoryParity).toBeCloseTo(10);
    expect(result.tierParity).toBeCloseTo(10);
  });

  test("brand offering only basics at extended sizes → tier parity < 5", () => {
    // flagship+mid items only have standard, basics have extended
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        category: "tops",
        tierClassification: "flagship",
        perSizeDataJson: {
          S: { available: true },
          M: { available: true },
          L: { available: true },
          XL: { available: true },
        },
      }),
      makeItem({
        id: 2,
        category: "tops",
        tierClassification: "mid",
        perSizeDataJson: {
          S: { available: true },
          M: { available: true },
          L: { available: true },
        },
      }),
      makeItem({
        id: 3,
        category: "tops",
        tierClassification: "basic",
        perSizeDataJson: {
          S: { available: true },
          XXL: { available: true },
          "2XL": { available: true },
        },
      }),
    ];

    const result = scoreRangeParity(items);
    // tierParity: stdWeighted = 2*1 + 1 = 3, extWeighted = 0, ratio = 0 → tierParity = 0
    expect(result.tierParity).toBe(0);
    // categoryParity: 1 category at extended (tops), 1 at standard → 1.0 → 10
    expect(result.categoryParity).toBeCloseTo(10);
    // score = (10 + 0) / 2 = 5
    expect(result.score).toBeCloseTo(5);
  });

  test("brand offering no extended sizes at all → score 0", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        category: "tops",
        tierClassification: "flagship",
        perSizeDataJson: {
          XS: { available: true },
          S: { available: true },
          M: { available: true },
          L: { available: true },
          XL: { available: true },
        },
      }),
      makeItem({
        id: 2,
        category: "bottoms",
        tierClassification: "mid",
        perSizeDataJson: {
          S: { available: true },
          M: { available: true },
          L: { available: true },
        },
      }),
    ];

    const result = scoreRangeParity(items);
    expect(result.score).toBe(0);
    expect(result.categoryParity).toBe(0);
    expect(result.tierParity).toBe(0);
  });

  test("all items discontinued → score 0", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        isDiscontinued: true,
        category: "tops",
        tierClassification: "flagship",
        perSizeDataJson: {
          S: { available: true },
          M: { available: true },
          XXL: { available: true },
        },
      }),
      makeItem({
        id: 2,
        isDiscontinued: true,
        category: "bottoms",
        tierClassification: "mid",
        perSizeDataJson: {
          S: { available: true },
          XXL: { available: true },
        },
      }),
    ];

    const result = scoreRangeParity(items);
    expect(result.score).toBe(0);
    expect(result.categoryParity).toBe(0);
    expect(result.tierParity).toBe(0);
    expect(result.rawCounts.standard.totalItems).toBe(0);
    expect(result.rawCounts.extended.totalItems).toBe(0);
  });

  test("returns correct raw counts", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        category: "tops",
        tierClassification: "flagship",
        perSizeDataJson: {
          S: { available: true },
          M: { available: true },
          XXL: { available: true },
        },
      }),
    ];

    const result = scoreRangeParity(items);
    expect(result.rawCounts.standard.totalItems).toBe(1);
    expect(result.rawCounts.extended.totalItems).toBe(1);
    expect(result.rawCounts.standard.flagshipCount).toBe(1);
    expect(result.rawCounts.extended.flagshipCount).toBe(1);
  });
});
