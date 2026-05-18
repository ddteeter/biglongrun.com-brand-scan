import { describe, test, expect } from "bun:test";
import nodePath from "node:path";
import { parseBlogReviewsDir } from "../../../src/domain/assessments/blog-parser";

const FIXTURES_DIR = nodePath.join(import.meta.dir, "../../fixtures/blog-reviews");

describe("parseBlogReviewsDir", () => {
  test("parses 3 fixture files but skips no-frontmatter.mdx → returns 2 reviews", async () => {
    const reviews = await parseBlogReviewsDir(FIXTURES_DIR);
    expect(reviews).toHaveLength(2);
  });

  test("brand names are correct", async () => {
    const reviews = await parseBlogReviewsDir(FIXTURES_DIR);
    const brands = reviews.map((r) => r.brand).toSorted((a, b) => a.localeCompare(b));
    expect(brands).toEqual(["Path Projects", "Tracksmith"]);
  });

  test("recursion finds the nested 2025/ subdirectory file", async () => {
    const reviews = await parseBlogReviewsDir(FIXTURES_DIR);
    const pathProjects = reviews.find((r) => r.brand === "Path Projects");
    expect(pathProjects).toBeDefined();
    expect(pathProjects?.filePath).toContain("2025");
  });

  test("sizeOptionsRating parsed from nested YAML block (Tracksmith)", async () => {
    const reviews = await parseBlogReviewsDir(FIXTURES_DIR);
    const ts = reviews.find((r) => r.brand === "Tracksmith");
    expect(ts).toBeDefined();
    expect(ts?.sizeOptionsRating).toBe(4);
  });

  test("sizeOptionsSummary parsed from nested YAML block (Tracksmith)", async () => {
    const reviews = await parseBlogReviewsDir(FIXTURES_DIR);
    const ts = reviews.find((r) => r.brand === "Tracksmith");
    expect(ts?.sizeOptionsSummary).toBe("Good range from XS–3XL, but tall options are limited");
  });

  test("sizeOptionsRating parsed for Path Projects", async () => {
    const reviews = await parseBlogReviewsDir(FIXTURES_DIR);
    const pp = reviews.find((r) => r.brand === "Path Projects");
    expect(pp?.sizeOptionsRating).toBe(7);
  });

  test("sizeOptionsSummary parsed for Path Projects", async () => {
    const reviews = await parseBlogReviewsDir(FIXTURES_DIR);
    const pp = reviews.find((r) => r.brand === "Path Projects");
    expect(pp?.sizeOptionsSummary).toBe("Excellent range including tall and big sizes");
  });

  test("reviewUrl is parsed", async () => {
    const reviews = await parseBlogReviewsDir(FIXTURES_DIR);
    const ts = reviews.find((r) => r.brand === "Tracksmith");
    expect(ts?.reviewUrl).toBe("https://biglongrun.com/reviews/tracksmith-storm-shorts");
  });

  test("date is parsed as string", async () => {
    const reviews = await parseBlogReviewsDir(FIXTURES_DIR);
    const ts = reviews.find((r) => r.brand === "Tracksmith");
    expect(ts?.date).toMatch(/2025-08-12/);
  });

  test("author is parsed", async () => {
    const reviews = await parseBlogReviewsDir(FIXTURES_DIR);
    const ts = reviews.find((r) => r.brand === "Tracksmith");
    expect(ts?.author).toBe("drew");
  });
});
