import { describe, test, expect } from "bun:test";
import { ShopifyCatalogDiscoverer } from "../../src/domain/catalog/shopify";
import { SitemapCatalogDiscoverer } from "../../src/domain/catalog/sitemap";
import { discoverBrandCatalog, type DiscoverDeps } from "../../src/domain/catalog/discoverer";
import { FirecrawlClient } from "../../src/infrastructure/external/firecrawl";
import { AnthropicClient } from "../../src/infrastructure/external/anthropic";
import { DomainRateLimiter } from "../../src/infrastructure/external/rate-limiter";

const SHOPIFY_RESPONSE = {
  products: [
    {
      id: 1,
      handle: "jacket",
      title: "Jacket",
      product_type: "Outerwear",
      options: [{ name: "Size", values: ["S", "M"] }],
      variants: [
        { id: 1, title: "S", available: true, price: "120.00", option1: "S" },
        { id: 2, title: "M", available: false, price: "120.00", option1: "M" },
      ],
    },
  ],
};

function urlToString(url: RequestInfo | URL): string {
  if (url instanceof URL) return url.href;
  if (url instanceof Request) return url.url;
  return url;
}

function makeDiscoverDeps(
  fetchFn: typeof globalThis.fetch,
  sdkCreate: () => unknown
): DiscoverDeps {
  return {
    shopify: new ShopifyCatalogDiscoverer(fetchFn),
    sitemap: new SitemapCatalogDiscoverer(fetchFn),
    firecrawl: new FirecrawlClient({ apiKey: "test", fetch: fetchFn }),
    anthropic: new AnthropicClient({
      apiKey: "test",
      sdkOverride: { messages: { create: sdkCreate } } as never,
    }),
    rateLimiter: new DomainRateLimiter({ minIntervalMs: 0 }),
    recordUsage: () => Promise.resolve(),
  };
}

describe("discoverBrandCatalog", () => {
  test("returns Shopify path drafts when /products.json works", async () => {
    const fetchFn = ((url: RequestInfo | URL): Promise<Response> => {
      if (urlToString(url) === "https://brand.com/products.json?page=1&limit=250") {
        return Promise.resolve(Response.json(SHOPIFY_RESPONSE));
      }
      return Promise.resolve(new Response("", { status: 404 }));
    }) as typeof globalThis.fetch;

    const deps = makeDiscoverDeps(fetchFn, () => {
      throw new Error("should not be called");
    });

    const result = await discoverBrandCatalog(deps, {
      brandId: 1,
      brandPrimaryUrl: "https://brand.com",
    });

    expect(result.source).toBe("shopify");
    expect(result.drafts.length).toBe(1);
    expect(result.drafts[0]?.name).toBe("Jacket");
  });

  test("falls back to sitemap path when /products.json missing", async () => {
    const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://brand.com/products/jacket</loc></url>
      </urlset>`;

    const fetchFn = ((url: RequestInfo | URL): Promise<Response> => {
      const key = urlToString(url);
      if (key === "https://brand.com/products.json?page=1&limit=250")
        return Promise.resolve(new Response("", { status: 404 }));
      if (key === "https://brand.com/sitemap.xml")
        return Promise.resolve(
          new Response(SITEMAP, { status: 200, headers: { "content-type": "application/xml" } })
        );
      if (key === "https://api.firecrawl.dev/v1/scrape") {
        return Promise.resolve(
          Response.json({
            success: true,
            data: {
              markdown: "# Jacket\nPrice $120 Sizes S, M",
              screenshot: "https://files.firecrawl.dev/x.png",
            },
          })
        );
      }
      if (key === "https://files.firecrawl.dev/x.png")
        return Promise.resolve(new Response(new Uint8Array([0]), { status: 200 }));
      return Promise.resolve(new Response("", { status: 404 }));
    }) as typeof globalThis.fetch;

    const deps = makeDiscoverDeps(fetchFn, () =>
      Promise.resolve({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              name: "Jacket",
              category: "Outerwear",
              base_price_usd: 120,
              per_size: {
                S: { available: true, price: 120 },
                M: { available: true, price: 120 },
              },
              confidence: 0.9,
            }),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      })
    );

    const result = await discoverBrandCatalog(deps, {
      brandId: 1,
      brandPrimaryUrl: "https://brand.com",
    });

    expect(result.source).toBe("sitemap");
    expect(result.drafts.length).toBe(1);
    expect(result.drafts[0]?.name).toBe("Jacket");
  });
});
