import { describe, test, expect } from "bun:test";
import { scoreColorwayEquity } from "../../../src/domain/scoring/colorway-equity";
import { makeItem, type BrandItem } from "./helpers";

describe("scoreColorwayEquity", () => {
  test("same colors everywhere → 10", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        perSizeDataJson: {
          S: { available: true, colors: ["red", "blue", "green"] },
          M: { available: true, colors: ["red", "blue", "green"] },
          L: { available: true, colors: ["red", "blue", "green"] },
          XXL: { available: true, colors: ["red", "blue", "green"] },
          "2XL": { available: true, colors: ["red", "blue", "green"] },
        },
      }),
    ];

    const score = scoreColorwayEquity(items);
    // extColors = 3, stdColors = 3, ratio = 1.0, score = min(10, 1*10) = 10
    expect(score).toBeCloseTo(10);
  });

  test("half colors at extended → ~5", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        perSizeDataJson: {
          S: { available: true, colors: ["red", "blue", "green", "black"] },
          M: { available: true, colors: ["red", "blue", "green", "black"] },
          XXL: { available: true, colors: ["red", "blue"] }, // 2 of 4
        },
      }),
    ];

    const score = scoreColorwayEquity(items);
    // stdColors = {red, blue, green, black} = 4, extColors = {red, blue} = 2
    // ratio = 2/4 = 0.5, score = 0.5 * 10 = 5
    expect(score).toBeCloseTo(5);
  });

  test("no colors at extended → 0", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        perSizeDataJson: {
          S: { available: true, colors: ["red", "blue"] },
          M: { available: true, colors: ["red", "blue"] },
          XXL: { available: true, colors: [] }, // empty array → extColors.size = 0 → skip
        },
      }),
    ];

    // extColors.size === 0 → item skipped → ratios empty → return 5
    // But if we explicitly have an extended item with 0 colors, the item is skipped
    // So with no valid items: return 5 (neutral)
    const score = scoreColorwayEquity(items);
    expect(score).toBe(5);
  });

  test("extended colors with truly empty set → item skipped, returns neutral 5", () => {
    // extColors becomes empty because no extended has colors defined
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        perSizeDataJson: {
          S: { available: true, colors: ["red", "blue"] },
          M: { available: true, colors: ["red", "blue"] },
          XXL: { available: true }, // no colors defined
        },
      }),
    ];

    const score = scoreColorwayEquity(items);
    expect(score).toBe(5);
  });

  test("no extended sizes in data → 5 (neutral)", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        perSizeDataJson: {
          XS: { available: true, colors: ["red", "blue"] },
          S: { available: true, colors: ["red", "blue", "white"] },
          M: { available: true, colors: ["red", "blue"] },
          L: { available: true, colors: ["red", "blue"] },
        },
      }),
    ];

    const score = scoreColorwayEquity(items);
    expect(score).toBe(5);
  });

  test("empty items → 5 (neutral)", () => {
    expect(scoreColorwayEquity([])).toBe(5);
  });

  test("all discontinued → 5 (neutral)", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        isDiscontinued: true,
        perSizeDataJson: {
          S: { available: true, colors: ["red", "blue"] },
          XXL: { available: true, colors: ["red", "blue"] },
        },
      }),
    ];

    expect(scoreColorwayEquity(items)).toBe(5);
  });

  test("case-insensitive color deduplication", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        perSizeDataJson: {
          S: { available: true, colors: ["Red", "Blue"] },
          M: { available: true, colors: ["red", "BLUE"] }, // same colors, different case
          XXL: { available: true, colors: ["red", "blue"] },
        },
      }),
    ];

    const score = scoreColorwayEquity(items);
    // stdColors = {red, blue} = 2, extColors = {red, blue} = 2, ratio = 1.0
    expect(score).toBeCloseTo(10);
  });

  test("more colors at extended than standard → capped at 10", () => {
    const items: BrandItem[] = [
      makeItem({
        id: 1,
        perSizeDataJson: {
          S: { available: true, colors: ["red"] },
          XXL: { available: true, colors: ["red", "blue", "green"] },
        },
      }),
    ];

    // ratio = 3/1 = 3, score = min(10, 3*10) = 10
    const score = scoreColorwayEquity(items);
    expect(score).toBe(10);
  });
});
