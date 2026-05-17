import { describe, test, expect } from "bun:test";
import { brandSlugFromName, resolveSlugCollision } from "../../src/domain/brands/slug";

describe("brandSlugFromName", () => {
  test("lowercases, hyphens, removes punctuation", () => {
    expect(brandSlugFromName("Path Projects")).toBe("path-projects");
    expect(brandSlugFromName("Lululemon Athletica")).toBe("lululemon-athletica");
    expect(brandSlugFromName("On Running™")).toBe("on-running");
    expect(brandSlugFromName("  Tracksmith  ")).toBe("tracksmith");
  });

  test("collapses repeated hyphens", () => {
    expect(brandSlugFromName("A & B")).toBe("a-b");
  });
});

describe("resolveSlugCollision", () => {
  test("returns base slug when no collision", () => {
    expect(resolveSlugCollision("brooks", new Set())).toBe("brooks");
  });

  test("appends -2, -3, ... on collision", () => {
    expect(resolveSlugCollision("brooks", new Set(["brooks"]))).toBe("brooks-2");
    expect(resolveSlugCollision("brooks", new Set(["brooks", "brooks-2"]))).toBe("brooks-3");
  });
});
