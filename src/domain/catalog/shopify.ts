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

function parseJsonBody(
  body: string,
  etag: string | null,
  lastModified: string | null,
  bodyHash: string,
  knownBodyHash?: string
): FetchResult<unknown> | null {
  if (knownBodyHash && knownBodyHash === bodyHash) return { kind: "unchanged" };
  let json: unknown;
  try {
    json = JSON.parse(body) as unknown;
  } catch {
    return null;
  }
  return isLikelyShopify(json)
    ? { kind: "changed", payload: json, etag, lastModified, bodyHash }
    : null;
}

export class ShopifyCatalogDiscoverer {
  constructor(private readonly fetchFn: typeof globalThis.fetch = globalThis.fetch) {}

  async tryFetch(
    brandPrimaryUrl: string,
    conditional?: ConditionalState
  ): Promise<FetchResult<unknown> | null> {
    const host = new URL(brandPrimaryUrl).host;
    const url = `https://${host}/products.json?limit=250`;
    try {
      const r = await this.fetchFn(url, { headers: buildConditionalHeaders(conditional) });
      if (r.status === 304) return { kind: "unchanged" };
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) return null;
      const body = await r.text();
      return parseJsonBody(
        body,
        r.headers.get("etag"),
        r.headers.get("last-modified"),
        hashBody(body),
        conditional?.bodyHash
      );
    } catch {
      return null;
    }
  }
}
