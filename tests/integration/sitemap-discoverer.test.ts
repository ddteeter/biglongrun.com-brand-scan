import { describe, test, expect } from "bun:test";
import { SitemapCatalogDiscoverer } from "../../src/domain/catalog/sitemap";

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://brand.com/</loc></url>
  <url><loc>https://brand.com/about</loc></url>
  <url><loc>https://brand.com/products/storm-jacket</loc></url>
  <url><loc>https://brand.com/products/sky-tee</loc></url>
  <url><loc>https://brand.com/blog/2026-news</loc></url>
</urlset>`;

const SITEMAP_INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://brand.com/sitemap-products.xml</loc></sitemap>
  <sitemap><loc>https://brand.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`;

const PRODUCTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://brand.com/products/storm-jacket</loc></url>
  <url><loc>https://brand.com/products/sky-tee</loc></url>
</urlset>`;

function urlToString(url: RequestInfo | URL): string {
  if (url instanceof URL) return url.href;
  if (url instanceof Request) return url.url;
  return url;
}

function makeXmlResponse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/xml", ...headers },
  });
}

function stubFetch(responses: Record<string, string>) {
  return (url: RequestInfo | URL): Promise<Response> => {
    const key = urlToString(url);
    const body = responses[key];
    if (!body) return Promise.resolve(new Response("", { status: 404 }));
    return Promise.resolve(makeXmlResponse(body));
  };
}

function stubFetchWithHeaders(
  responses: Record<string, { body: string; headers?: Record<string, string> }>
) {
  return (url: RequestInfo | URL): Promise<Response> => {
    const key = urlToString(url);
    const r = responses[key];
    if (!r) return Promise.resolve(new Response("", { status: 404 }));
    return Promise.resolve(makeXmlResponse(r.body, r.headers));
  };
}

function stub304Fetch(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 304 }));
}

describe("SitemapCatalogDiscoverer", () => {
  test("returns product URLs from flat sitemap", async () => {
    const d = new SitemapCatalogDiscoverer(
      stubFetch({
        "https://brand.com/sitemap.xml": SITEMAP_XML,
      }) as unknown as typeof globalThis.fetch
    );
    const result = await d.discover("https://brand.com");
    expect(result.kind).toBe("changed");
    if (result.kind === "changed") {
      const sorted = result.payload.toSorted((a, b) => a.localeCompare(b));
      expect(sorted).toEqual([
        "https://brand.com/products/sky-tee",
        "https://brand.com/products/storm-jacket",
      ]);
    }
  });

  test("follows sitemap index and aggregates", async () => {
    const d = new SitemapCatalogDiscoverer(
      stubFetch({
        "https://brand.com/sitemap.xml": SITEMAP_INDEX_XML,
        "https://brand.com/sitemap-products.xml": PRODUCTS_XML,
        "https://brand.com/sitemap-pages.xml": SITEMAP_XML,
      }) as unknown as typeof globalThis.fetch
    );
    const result = await d.discover("https://brand.com");
    expect(result.kind).toBe("changed");
    if (result.kind === "changed") {
      expect(result.payload.length).toBe(2);
      expect(result.payload.every((u) => u.includes("/products/"))).toBe(true);
    }
  });

  test("returns empty payload when sitemap missing", async () => {
    const d = new SitemapCatalogDiscoverer(stubFetch({}) as unknown as typeof globalThis.fetch);
    const result = await d.discover("https://brand.com");
    expect(result.kind).toBe("changed");
    if (result.kind === "changed") {
      expect(result.payload).toEqual([]);
    }
  });

  test("sends conditional headers when provided", async () => {
    const capturedHeaders: Record<string, string> = {};
    const capturingFetch = (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const hdrs = init?.headers as Record<string, string> | undefined;
      if (hdrs) Object.assign(capturedHeaders, hdrs);
      const key = urlToString(url);
      if (key === "https://brand.com/sitemap.xml") {
        return Promise.resolve(makeXmlResponse(SITEMAP_XML));
      }
      return Promise.resolve(new Response("", { status: 404 }));
    };
    const d = new SitemapCatalogDiscoverer(capturingFetch as unknown as typeof globalThis.fetch);
    await d.discover("https://brand.com", {
      etag: '"old-etag"',
      lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
    });
    expect(capturedHeaders["If-None-Match"]).toBe('"old-etag"');
    expect(capturedHeaders["If-Modified-Since"]).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
  });

  test("returns { kind: 'unchanged' } on 304", async () => {
    const d = new SitemapCatalogDiscoverer(stub304Fetch as unknown as typeof globalThis.fetch);
    const result = await d.discover("https://brand.com", { etag: '"abc"' });
    expect(result).toEqual({ kind: "unchanged" });
  });

  test("returns { kind: 'unchanged' } when body hash matches", async () => {
    const { createHash } = await import("node:crypto");
    const bodyHash = createHash("sha256").update(SITEMAP_XML).digest("hex");
    const d = new SitemapCatalogDiscoverer(
      stubFetchWithHeaders({
        "https://brand.com/sitemap.xml": { body: SITEMAP_XML, headers: { etag: '"rotated"' } },
      }) as unknown as typeof globalThis.fetch
    );
    const result = await d.discover("https://brand.com", { bodyHash });
    expect(result).toEqual({ kind: "unchanged" });
  });

  test("returns { kind: 'changed', payload, etag, lastModified, bodyHash } on new body", async () => {
    const { createHash } = await import("node:crypto");
    const expectedHash = createHash("sha256").update(SITEMAP_XML).digest("hex");
    const d = new SitemapCatalogDiscoverer(
      stubFetchWithHeaders({
        "https://brand.com/sitemap.xml": {
          body: SITEMAP_XML,
          headers: { etag: '"new-etag"', "last-modified": "Tue, 01 Jan 2026 00:00:00 GMT" },
        },
      }) as unknown as typeof globalThis.fetch
    );
    const result = await d.discover("https://brand.com");
    expect(result.kind).toBe("changed");
    if (result.kind === "changed") {
      expect(result.etag).toBe('"new-etag"');
      expect(result.lastModified).toBe("Tue, 01 Jan 2026 00:00:00 GMT");
      expect(result.bodyHash).toBe(expectedHash);
      expect(result.payload.length).toBeGreaterThan(0);
    }
  });
});
