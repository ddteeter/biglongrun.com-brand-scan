import { describe, test, expect } from "bun:test";
import { FirecrawlClient } from "../../src/infrastructure/external/firecrawl";

function urlToString(url: RequestInfo | URL): string {
  if (typeof url === "string") return url;
  if (url instanceof URL) return url.href;
  return url.url;
}

const stubFetch =
  (responses: Record<string, Response>) =>
  (url: RequestInfo | URL): Promise<Response> => {
    const key = urlToString(url);
    const r = responses[key];
    if (!r) throw new Error(`Unmocked URL: ${key}`);
    return Promise.resolve(r);
  };

describe("FirecrawlClient.headOnly", () => {
  test("returns 304 not modified when ETag matches", async () => {
    const client = new FirecrawlClient({
      apiKey: "test",
      fetch: stubFetch({
        "https://brand.com/size": new Response(null, { status: 304 }),
      }) as typeof globalThis.fetch,
    });
    const r = await client.headOnly("https://brand.com/size", {
      etag: '"abc"',
      lastModified: "Wed, 01 Jan 2025 00:00:00 GMT",
    });
    expect(r.kind).toBe("unchanged");
  });

  test("returns body + new ETag on 200", async () => {
    const body = "size chart html";
    const client = new FirecrawlClient({
      apiKey: "test",
      fetch: stubFetch({
        "https://brand.com/size": new Response(body, {
          status: 200,
          headers: { etag: '"new"', "last-modified": "Thu, 02 Jan 2025 00:00:00 GMT" },
        }),
      }) as typeof globalThis.fetch,
    });
    const r = await client.headOnly("https://brand.com/size", {});
    expect(r.kind).toBe("changed");
    if (r.kind === "changed") {
      expect(r.body).toBe(body);
      expect(r.etag).toBe('"new"');
    }
  });
});

describe("FirecrawlClient.render", () => {
  test("returns markdown + screenshot bytes on success", async () => {
    const client = new FirecrawlClient({
      apiKey: "test",
      fetch: stubFetch({
        "https://api.firecrawl.dev/v1/scrape": Response.json({
          success: true,
          data: {
            markdown: "# size chart\n| size | chest |\n|---|---|\n| S | 36 |",
            screenshot: "https://files.firecrawl.dev/screenshots/abc.png",
          },
        }),
        "https://files.firecrawl.dev/screenshots/abc.png": new Response(
          new Uint8Array([137, 80, 78, 71]),
          { status: 200 }
        ),
      }) as typeof globalThis.fetch,
    });
    const r = await client.render("https://brand.com/size");
    expect(r.markdown).toContain("size chart");
    expect(r.screenshotBytes.byteLength).toBeGreaterThan(0);
  });

  test("throws on Firecrawl error", async () => {
    const client = new FirecrawlClient({
      apiKey: "test",
      fetch: stubFetch({
        "https://api.firecrawl.dev/v1/scrape": Response.json(
          { success: false, error: "rate limit" },
          { status: 429 }
        ),
      }) as typeof globalThis.fetch,
    });
    let threw = false;
    try {
      await client.render("https://brand.com/size");
    } catch (error) {
      threw = true;
      expect((error as Error).message).toMatch(/rate limit/);
    }
    expect(threw).toBe(true);
  });
});
