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

const stubFetch =
  (responses: Record<string, string>) =>
  (url: RequestInfo | URL): Promise<Response> => {
    const key = urlToString(url);
    const body = responses[key];
    if (!body) return Promise.resolve(new Response("", { status: 404 }));
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "content-type": "application/xml" } })
    );
  };

describe("SitemapCatalogDiscoverer", () => {
  test("returns product URLs from flat sitemap", async () => {
    const d = new SitemapCatalogDiscoverer(
      stubFetch({ "https://brand.com/sitemap.xml": SITEMAP_XML }) as typeof globalThis.fetch
    );
    const urls = await d.discover("https://brand.com");
    const sorted = urls.toSorted((a, b) => a.localeCompare(b));
    expect(sorted).toEqual([
      "https://brand.com/products/sky-tee",
      "https://brand.com/products/storm-jacket",
    ]);
  });

  test("follows sitemap index and aggregates", async () => {
    const d = new SitemapCatalogDiscoverer(
      stubFetch({
        "https://brand.com/sitemap.xml": SITEMAP_INDEX_XML,
        "https://brand.com/sitemap-products.xml": PRODUCTS_XML,
        "https://brand.com/sitemap-pages.xml": SITEMAP_XML,
      }) as typeof globalThis.fetch
    );
    const urls = await d.discover("https://brand.com");
    expect(urls.length).toBe(2);
    expect(urls.every((u) => u.includes("/products/"))).toBe(true);
  });

  test("returns empty array when sitemap missing", async () => {
    const d = new SitemapCatalogDiscoverer(stubFetch({}) as typeof globalThis.fetch);
    expect(await d.discover("https://brand.com")).toEqual([]);
  });
});
