import { describe, test, expect } from "bun:test";
import { createHash } from "node:crypto";
import {
  isLikelyShopify,
  parseShopifyProductsJson,
  ShopifyCatalogDiscoverer,
} from "../../../src/domain/catalog/shopify";

const SAMPLE = {
  products: [
    {
      id: 123,
      handle: "storm-jacket",
      title: "Storm Jacket",
      product_type: "Outerwear",
      variants: [
        { id: 1, title: "S", available: true, price: "120.00", option1: "S" },
        { id: 2, title: "M", available: true, price: "120.00", option1: "M" },
        { id: 3, title: "L", available: false, price: "120.00", option1: "L" },
      ],
      options: [{ name: "Size", values: ["S", "M", "L"] }],
      images: [{ src: "https://cdn.shopify.com/x.jpg" }],
    },
    {
      id: 124,
      handle: "tee",
      title: "Cotton Tee",
      product_type: "Tops",
      variants: [
        { id: 10, title: "Default", available: true, price: "35.00", option1: "S" },
        { id: 11, title: "Default", available: true, price: "35.00", option1: "M" },
      ],
      options: [{ name: "Size", values: ["S", "M"] }],
      images: [],
    },
  ],
};

const SAMPLE_BODY = JSON.stringify(SAMPLE);

// The combined-hash is computed by sorting products by id and hashing the JSON
function computeExpectedHash(products: { id: number }[]): string {
  const sorted = products.toSorted((a, b) => a.id - b.id);
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/** Normalise any fetch-URL argument to a plain string. */
function urlKey(url: RequestInfo | URL): string {
  if (url instanceof URL) return url.href;
  if (url instanceof Request) return url.url;
  return url;
}

/** Build a fetch stub that routes by URL string. */
function makePagedFetch(
  routes: Record<string, { body: string; status?: number; headers?: Record<string, string> }>
) {
  return (url: RequestInfo | URL): Promise<Response> => {
    const key = urlKey(url);
    const r = routes[key];
    if (!r) return Promise.resolve(new Response("Not Found", { status: 404 }));
    const responseHeaders: Record<string, string> = { "content-type": "application/json" };
    if (r.headers) Object.assign(responseHeaders, r.headers);
    return Promise.resolve(
      new Response(r.body, { status: r.status ?? 200, headers: responseHeaders })
    );
  };
}

function stub304(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 304 }));
}

function stub404(): Promise<Response> {
  return Promise.resolve(new Response("Not Found", { status: 404 }));
}

/** Build N minimal products with sequential ids starting at startId. */
function makePage(startId: number, count: number): { products: unknown[] } {
  return {
    products: Array.from({ length: count }, (_, i) => ({
      id: startId + i,
      handle: `product-${String(startId + i)}`,
      title: `Product ${String(startId + i)}`,
      product_type: "Tops",
      variants: [{ id: startId + i, title: "S", available: true, price: "50.00", option1: "S" }],
      options: [{ name: "Size", values: ["S"] }],
    })),
  };
}

describe("shopify catalog parser", () => {
  test("isLikelyShopify true for valid /products.json response", () => {
    expect(isLikelyShopify({ products: [] })).toBe(true);
    expect(isLikelyShopify({ items: [] })).toBe(false);
    expect(isLikelyShopify(null)).toBe(false);
    expect(isLikelyShopify("string")).toBe(false);
  });

  test("parseShopifyProductsJson returns ItemDrafts for each product", () => {
    const drafts = parseShopifyProductsJson(SAMPLE, {
      brandId: 1,
      brandHost: "tracksmith.com",
    });
    expect(drafts.length).toBe(2);
    const jacket = drafts.find((d) => d.name === "Storm Jacket");
    expect(jacket?.sourceUrl).toBe("https://tracksmith.com/products/storm-jacket");
    expect(jacket?.basePriceUsd).toBe(120);
    expect(jacket?.externalId).toBe("storm-jacket");
    expect(jacket?.category).toBe("Outerwear");
    expect(jacket?.perSizeData.S?.available).toBe(true);
    expect(jacket?.perSizeData.L?.available).toBe(false);
  });
});

describe("ShopifyCatalogDiscoverer conditional fetch", () => {
  test("sends conditional headers on page-1 request", async () => {
    const capturedHeaders: Record<string, string> = {};
    const capturingFetch = (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (urlKey(url).includes("page=1")) {
        const hdrs = init?.headers as Record<string, string> | undefined;
        if (hdrs) Object.assign(capturedHeaders, hdrs);
      }
      return Promise.resolve(
        new Response(SAMPLE_BODY, {
          status: 200,
          headers: { "content-type": "application/json", etag: '"abc"' },
        })
      );
    };
    const d = new ShopifyCatalogDiscoverer(capturingFetch as unknown as typeof globalThis.fetch);
    await d.tryFetch("https://brand.com", {
      etag: '"old"',
      lastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
    });
    expect(capturedHeaders["If-None-Match"]).toBe('"old"');
    expect(capturedHeaders["If-Modified-Since"]).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
  });

  test("returns { kind: 'unchanged' } on 304", async () => {
    const d = new ShopifyCatalogDiscoverer(stub304 as unknown as typeof globalThis.fetch);
    const result = await d.tryFetch("https://brand.com", { etag: '"abc"' });
    expect(result).toEqual({ kind: "unchanged" });
  });

  test("returns { kind: 'unchanged' } when combined body hash matches", async () => {
    const bodyHash = computeExpectedHash(SAMPLE.products);
    const fetchFn = makePagedFetch({
      "https://brand.com/products.json?page=1&limit=250": {
        body: SAMPLE_BODY,
        headers: { etag: '"rotated"' },
      },
    });
    const d = new ShopifyCatalogDiscoverer(fetchFn as unknown as typeof globalThis.fetch);
    const result = await d.tryFetch("https://brand.com", { bodyHash });
    expect(result).toEqual({ kind: "unchanged" });
  });

  test("returns { kind: 'changed', payload, etag, lastModified, bodyHash } on new body", async () => {
    const expectedHash = computeExpectedHash(SAMPLE.products);
    const fetchFn = makePagedFetch({
      "https://brand.com/products.json?page=1&limit=250": {
        body: SAMPLE_BODY,
        headers: { etag: '"new-etag"', "last-modified": "Tue, 01 Jan 2026 00:00:00 GMT" },
      },
    });
    const d = new ShopifyCatalogDiscoverer(fetchFn as unknown as typeof globalThis.fetch);
    const result = await d.tryFetch("https://brand.com");
    expect(result?.kind).toBe("changed");
    if (result?.kind === "changed") {
      expect(result.etag).toBe('"new-etag"');
      expect(result.lastModified).toBe("Tue, 01 Jan 2026 00:00:00 GMT");
      expect(result.bodyHash).toBe(expectedHash);
      expect(isLikelyShopify(result.payload)).toBe(true);
    }
  });

  test("returns null when products.json not found", async () => {
    const d = new ShopifyCatalogDiscoverer(stub404 as unknown as typeof globalThis.fetch);
    const result = await d.tryFetch("https://brand.com");
    expect(result).toBeNull();
  });
});

describe("ShopifyCatalogDiscoverer pagination", () => {
  test("fetches all pages and returns combined 300 products (page1=250, page2=50, page3=empty)", async () => {
    const page1 = makePage(1, 250);
    const page2 = makePage(251, 50);
    const page3 = { products: [] as unknown[] };

    const fetchFn = makePagedFetch({
      "https://brand.com/products.json?page=1&limit=250": { body: JSON.stringify(page1) },
      "https://brand.com/products.json?page=2&limit=250": { body: JSON.stringify(page2) },
      "https://brand.com/products.json?page=3&limit=250": { body: JSON.stringify(page3) },
    });

    const d = new ShopifyCatalogDiscoverer(fetchFn as unknown as typeof globalThis.fetch);
    const result = await d.tryFetch("https://brand.com");

    expect(result?.kind).toBe("changed");
    if (result?.kind === "changed") {
      const payload = result.payload as { products: unknown[] };
      expect(payload.products.length).toBe(300);
    }
  });

  test("does NOT fetch page 2 when page 1 returns fewer than 250 products", async () => {
    const page1 = makePage(1, 5);
    let page2Fetched = false;

    const fetchFn = (url: RequestInfo | URL): Promise<Response> => {
      const key = urlKey(url);
      if (key.includes("page=2")) page2Fetched = true;
      if (key.includes("page=1")) {
        return Promise.resolve(Response.json(page1));
      }
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    };

    const d = new ShopifyCatalogDiscoverer(fetchFn as unknown as typeof globalThis.fetch);
    const result = await d.tryFetch("https://brand.com");

    expect(result?.kind).toBe("changed");
    expect(page2Fetched).toBe(false);
    if (result?.kind === "changed") {
      const payload = result.payload as { products: unknown[] };
      expect(payload.products.length).toBe(5);
    }
  });

  test("combined body hash is stable regardless of per-page product order", async () => {
    const productsForwardOrder = [
      { id: 1, handle: "a", title: "A", product_type: "", variants: [], options: [] },
      { id: 2, handle: "b", title: "B", product_type: "", variants: [], options: [] },
    ];
    const productsReverseOrder = [
      { id: 2, handle: "b", title: "B", product_type: "", variants: [], options: [] },
      { id: 1, handle: "a", title: "A", product_type: "", variants: [], options: [] },
    ];

    // Discoverer A: ids in ascending order
    const fetchA = makePagedFetch({
      "https://brand.com/products.json?page=1&limit=250": {
        body: JSON.stringify({ products: productsForwardOrder }),
      },
    });
    const dA = new ShopifyCatalogDiscoverer(fetchA as unknown as typeof globalThis.fetch);
    const resultA = await dA.tryFetch("https://brand.com");

    // Discoverer B: ids in descending order (simulating different per-page ordering)
    const fetchB = makePagedFetch({
      "https://brand.com/products.json?page=1&limit=250": {
        body: JSON.stringify({ products: productsReverseOrder }),
      },
    });
    const dB = new ShopifyCatalogDiscoverer(fetchB as unknown as typeof globalThis.fetch);
    const resultB = await dB.tryFetch("https://brand.com");

    expect(resultA?.kind).toBe("changed");
    expect(resultB?.kind).toBe("changed");
    if (resultA?.kind === "changed" && resultB?.kind === "changed") {
      expect(resultA.bodyHash).toBe(resultB.bodyHash);
    }
  });

  test("page-2 returning empty stops pagination immediately (no page-3 fetch)", async () => {
    const page1 = makePage(1, 250);
    const page2 = { products: [] as unknown[] };
    let page3Fetched = false;

    const fetchFn = (url: RequestInfo | URL): Promise<Response> => {
      const key = urlKey(url);
      if (key.includes("page=3")) page3Fetched = true;
      if (key === "https://brand.com/products.json?page=1&limit=250")
        return Promise.resolve(Response.json(page1));
      if (key === "https://brand.com/products.json?page=2&limit=250")
        return Promise.resolve(Response.json(page2));
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    };

    const d = new ShopifyCatalogDiscoverer(fetchFn as unknown as typeof globalThis.fetch);
    const result = await d.tryFetch("https://brand.com");

    expect(page3Fetched).toBe(false);
    expect(result?.kind).toBe("changed");
    if (result?.kind === "changed") {
      const payload = result.payload as { products: unknown[] };
      expect(payload.products.length).toBe(250);
    }
  });
});
