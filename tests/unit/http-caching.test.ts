import { describe, test, expect } from "bun:test";
import { computeEtag, cacheHeaders, notModified } from "../../src/infrastructure/http/caching";

describe("caching helpers", () => {
  test("computeEtag is stable for same input", () => {
    expect(computeEtag("hello")).toBe(computeEtag("hello"));
  });

  test("cacheHeaders includes etag and cache-control", () => {
    const h = cacheHeaders(300, '"abc"');
    expect(h["cache-control"]).toBe("public, max-age=300");
    expect(h.etag).toBe('"abc"');
  });

  test("notModified handles single and CSV If-None-Match", () => {
    expect(notModified('"abc"', '"abc"')).toBe(true);
    expect(notModified('"abc", "def"', '"def"')).toBe(true);
    expect(notModified('"abc"', '"zzz"')).toBe(false);
    expect(notModified(null, '"abc"')).toBe(false);
  });
});
