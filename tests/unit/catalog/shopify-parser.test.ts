import { describe, test, expect } from "bun:test";
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

function makeResponse(
  body: string,
  status: number,
  headers: Record<string, string> = {}
): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function makeOkFetch(body: string, headers: Record<string, string> = {}) {
  return (): Promise<Response> => Promise.resolve(makeResponse(body, 200, headers));
}

function stub304(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 304 }));
}

function stub404(): Promise<Response> {
  return Promise.resolve(new Response("Not Found", { status: 404 }));
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
  test("sends conditional headers when provided", async () => {
    const capturedHeaders: Record<string, string> = {};
    const capturingFetch = (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const hdrs = init?.headers as Record<string, string> | undefined;
      if (hdrs) Object.assign(capturedHeaders, hdrs);
      return Promise.resolve(makeResponse(SAMPLE_BODY, 200, { etag: '"abc"' }));
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

  test("returns { kind: 'unchanged' } when body hash matches", async () => {
    const { createHash } = await import("node:crypto");
    const bodyHash = createHash("sha256").update(SAMPLE_BODY).digest("hex");
    const d = new ShopifyCatalogDiscoverer(
      makeOkFetch(SAMPLE_BODY, { etag: '"rotated"' }) as unknown as typeof globalThis.fetch
    );
    const result = await d.tryFetch("https://brand.com", { bodyHash });
    expect(result).toEqual({ kind: "unchanged" });
  });

  test("returns { kind: 'changed', payload, etag, lastModified, bodyHash } on new body", async () => {
    const { createHash } = await import("node:crypto");
    const expectedHash = createHash("sha256").update(SAMPLE_BODY).digest("hex");
    const d = new ShopifyCatalogDiscoverer(
      makeOkFetch(SAMPLE_BODY, {
        etag: '"new-etag"',
        "last-modified": "Tue, 01 Jan 2026 00:00:00 GMT",
      }) as unknown as typeof globalThis.fetch
    );
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
