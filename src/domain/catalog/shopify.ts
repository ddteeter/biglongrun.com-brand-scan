import { createHash } from "node:crypto";
import { z } from "zod";
import type { ItemDraft, PerSizeData } from "./types";

const VariantSchema = z.object({
  id: z.number(),
  title: z.string(),
  available: z.boolean(),
  price: z.string(),
  option1: z.string().nullable().optional(),
  option2: z.string().nullable().optional(),
  option3: z.string().nullable().optional(),
});

const ProductSchema = z.object({
  id: z.number(),
  handle: z.string(),
  title: z.string(),
  product_type: z.string().default(""),
  variants: z.array(VariantSchema),
  options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).default([]),
});

const ProductsJsonSchema = z.object({
  products: z.array(ProductSchema),
});

export function isLikelyShopify(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    Array.isArray((raw as { products?: unknown }).products)
  );
}

export interface ParseShopifyOptions {
  brandId: number;
  brandHost: string; // e.g., "tracksmith.com"
}

type Variant = z.infer<typeof VariantSchema>;

function sizeKeyForVariant(variant: Variant, sizeOptionIndex: number): string | null {
  if (sizeOptionIndex === 0) return variant.option1 ?? null;
  if (sizeOptionIndex === 1) return variant.option2 ?? null;
  if (sizeOptionIndex === 2) return variant.option3 ?? null;
  return null;
}

function variantToPerSizeEntry(variant: Variant): { available: boolean; price?: number } {
  const priceNum = Number.parseFloat(variant.price);
  return {
    available: variant.available,
    ...(Number.isFinite(priceNum) ? { price: priceNum } : {}),
  };
}

function buildPerSizeDataWithIndex(
  product: z.infer<typeof ProductSchema>,
  sizeOptionIndex: number
): PerSizeData {
  const sizes: string[] = product.options[sizeOptionIndex]?.values ?? [];
  const perSize: PerSizeData = {};

  for (const variant of product.variants) {
    const size = sizeKeyForVariant(variant, sizeOptionIndex);
    if (size) perSize[size] = variantToPerSizeEntry(variant);
  }
  // Ensure listed sizes have entries even if no variant matched
  for (const s of sizes) {
    if (!(s in perSize)) perSize[s] = { available: false };
  }
  return perSize;
}

function buildPerSizeDataNoIndex(product: z.infer<typeof ProductSchema>): PerSizeData {
  const perSize: PerSizeData = {};
  for (const variant of product.variants) {
    const key = variant.option1;
    if (key) perSize[key] = variantToPerSizeEntry(variant);
  }
  return perSize;
}

export function parseShopifyProductsJson(raw: unknown, opts: ParseShopifyOptions): ItemDraft[] {
  const parsed = ProductsJsonSchema.parse(raw);
  const drafts: ItemDraft[] = [];
  const host = opts.brandHost.replace(/^https?:\/\//, "").replace(/\/$/, "");
  for (const product of parsed.products) {
    const sizeOptionIndex = product.options.findIndex((o) => /size/i.test(o.name));
    const perSizeData =
      sizeOptionIndex === -1
        ? buildPerSizeDataNoIndex(product)
        : buildPerSizeDataWithIndex(product, sizeOptionIndex);

    const firstPrice = product.variants[0]?.price;
    const basePrice = firstPrice === undefined ? null : Number.parseFloat(firstPrice);

    drafts.push({
      brandId: opts.brandId,
      externalId: product.handle,
      sourceUrl: `https://${host}/products/${product.handle}`,
      name: product.title,
      category: product.product_type || "uncategorized",
      basePriceUsd: Number.isFinite(basePrice) && basePrice !== null ? basePrice : null,
      perSizeData,
    });
  }
  return drafts;
}

export interface ConditionalState {
  etag?: string;
  lastModified?: string;
  bodyHash?: string;
}

export type FetchResult<T> =
  | { kind: "unchanged" }
  | {
      kind: "changed";
      payload: T;
      etag: string | null;
      lastModified: string | null;
      bodyHash: string;
    };

function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function buildConditionalHeaders(conditional?: ConditionalState): Record<string, string> {
  const headers: Record<string, string> = { "user-agent": "brand-scan/1.0" };
  if (conditional?.etag) headers["If-None-Match"] = conditional.etag;
  if (conditional?.lastModified) headers["If-Modified-Since"] = conditional.lastModified;
  return headers;
}

const MAX_SHOPIFY_PAGES = 40; // safety cap: 40 × 250 = 10,000 products

/** Sort products by numeric id for a stable combined hash across paginated responses. */
function sortProductsById(products: unknown[]): unknown[] {
  return products.toSorted((a, b) => {
    const aId = (a as { id: number }).id;
    const bId = (b as { id: number }).id;
    return aId - bId;
  });
}

/** Compute a stable hash over the combined (sorted) products array. */
function hashProducts(products: unknown[]): string {
  return hashBody(JSON.stringify(sortProductsById(products)));
}

/** Attempt to parse a page response body as a Shopify products array. Returns null on failure. */
function parsePageProducts(body: string): unknown[] | null {
  let json: unknown;
  try {
    json = JSON.parse(body) as unknown;
  } catch {
    return null;
  }
  if (!isLikelyShopify(json)) return null;
  return (json as { products: unknown[] }).products;
}

/** Fetch a single page; return null on network/non-OK error, undefined on non-JSON content-type. */
async function fetchPageText(
  fetchFn: typeof globalThis.fetch,
  url: string,
  headers: Record<string, string>
): Promise<{ text: string; resp: Response } | null> {
  let resp: Response;
  try {
    resp = await fetchFn(url, { headers });
  } catch {
    return null;
  }
  if (!resp.ok) return null;
  const ct = resp.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return null;
  try {
    const text = await resp.text();
    return { text, resp };
  } catch {
    return null;
  }
}

/** Fetch pages 2..MAX until empty, appending results to allProducts. */
async function fetchRemainingPages(
  fetchFn: typeof globalThis.fetch,
  host: string,
  allProducts: unknown[]
): Promise<void> {
  let page = 2;
  while (page <= MAX_SHOPIFY_PAGES) {
    const pageUrl = `https://${host}/products.json?page=${String(page)}&limit=250`;
    const result = await fetchPageText(fetchFn, pageUrl, { "user-agent": "brand-scan/1.0" });
    if (!result) break;

    const products = parsePageProducts(result.text);
    if (!products || products.length === 0) break;

    allProducts.push(...products);

    if (products.length < 250) break; // partial page → last page
    page++;
  }

  if (page > MAX_SHOPIFY_PAGES) {
    console.warn(
      `[shopify] hit ${String(MAX_SHOPIFY_PAGES)}-page safety cap for host ${host}; catalog may be truncated`
    );
  }
}

/** Build the final FetchResult given the combined products array. */
function buildResult(
  allProducts: unknown[],
  etag: string | null,
  lastModified: string | null,
  knownBodyHash?: string
): FetchResult<unknown> {
  const bodyHash = hashProducts(allProducts);
  if (knownBodyHash && knownBodyHash === bodyHash) return { kind: "unchanged" };
  return { kind: "changed", payload: { products: allProducts }, etag, lastModified, bodyHash };
}

export class ShopifyCatalogDiscoverer {
  constructor(private readonly fetchFn: typeof globalThis.fetch = globalThis.fetch) {}

  async tryFetch(
    brandPrimaryUrl: string,
    conditional?: ConditionalState
  ): Promise<FetchResult<unknown> | null> {
    const host = new URL(brandPrimaryUrl).host;
    const page1Url = `https://${host}/products.json?page=1&limit=250`;

    // Page 1 — send conditional headers for the fast-path 304 case
    const page1Result = await fetchPageText(
      this.fetchFn,
      page1Url,
      buildConditionalHeaders(conditional)
    );

    // Handle 304 before fetchPageText (it only returns null for non-ok, so check separately)
    // fetchPageText returns null on !resp.ok, but 304 is handled here via a pre-check
    if (!page1Result) {
      // Could be 304 (which fetchPageText doesn't handle), non-ok, or network error.
      // Re-issue to detect 304.
      let earlyResp: Response;
      try {
        earlyResp = await this.fetchFn(page1Url, {
          headers: buildConditionalHeaders(conditional),
        });
      } catch {
        return null;
      }
      if (earlyResp.status === 304) return { kind: "unchanged" };
      return null;
    }

    const page1Products = parsePageProducts(page1Result.text);
    if (!page1Products) return null;

    const page1Etag = page1Result.resp.headers.get("etag");
    const page1LastModified = page1Result.resp.headers.get("last-modified");

    const allProducts: unknown[] = [...page1Products];

    // Only paginate if the first page was full
    if (allProducts.length >= 250) {
      await fetchRemainingPages(this.fetchFn, host, allProducts);
    }

    return buildResult(allProducts, page1Etag, page1LastModified, conditional?.bodyHash);
  }
}
