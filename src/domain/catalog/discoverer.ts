import { createHash } from "node:crypto";
import type {
  FirecrawlClient,
  AnthropicClient,
  DomainRateLimiter,
} from "../../infrastructure/external";
import { estimateAnthropicCost, MODEL_SONNET } from "../../infrastructure/external";
import {
  parseShopifyProductsJson,
  type ShopifyCatalogDiscoverer,
  type ConditionalState,
} from "./shopify";
import type { SitemapCatalogDiscoverer } from "./sitemap";
import { extractItemDetail } from "./item-extractor";
import type { ItemDraft } from "./types";

export interface DiscoverDeps {
  shopify: ShopifyCatalogDiscoverer;
  sitemap: SitemapCatalogDiscoverer;
  firecrawl: FirecrawlClient;
  anthropic: AnthropicClient;
  rateLimiter: DomainRateLimiter;
  recordUsage: (input: {
    provider: "firecrawl" | "anthropic";
    unitsUsed: number;
    unitsKind: string;
    estimatedCostUsd: number;
  }) => Promise<void>;
  /** Optional: returns existing item fetch state for a given URL, used for per-item conditional GETs */
  loadItemFetchState?: (sourceUrl: string) => Promise<{
    lastEtag: string | null;
    lastModifiedHeader: string | null;
    lastFetchHash: string | null;
  } | null>;
}

export interface DiscoverInput {
  brandId: number;
  brandPrimaryUrl: string;
  maxSitemapItems?: number; // safety cap when falling back to per-item extraction
  /** Conditional state for the catalog root (sitemap.xml or products.json) */
  catalogConditional?: ConditionalState;
}

export interface ItemFetchState {
  etag: string | null;
  lastModified: string | null;
  bodyHash: string;
}

export interface ItemDraftWithFetchState extends ItemDraft {
  fetchState: ItemFetchState | null;
}

export interface DiscoverResult {
  source: "shopify" | "sitemap" | "none";
  unchanged?: boolean;
  catalogFetchState: ItemFetchState | null;
  drafts: ItemDraftWithFetchState[];
}

const FIRECRAWL_COST_PER_PAGE = 0;

function hostnameOf(url: string): string {
  return new URL(url).host;
}

function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

/** Performs a cheap conditional GET for a single item URL and returns the result. */
async function conditionalGetItem(
  url: string,
  existing: {
    lastEtag: string | null;
    lastModifiedHeader: string | null;
    lastFetchHash: string | null;
  }
): Promise<{ skip: boolean; fetchState: ItemFetchState | null }> {
  const headers: Record<string, string> = { "user-agent": "brand-scan/1.0" };
  if (existing.lastEtag) headers["If-None-Match"] = existing.lastEtag;
  if (existing.lastModifiedHeader) headers["If-Modified-Since"] = existing.lastModifiedHeader;

  try {
    const resp = await globalThis.fetch(url, { headers });
    if (resp.status === 304) return { skip: true, fetchState: null };
    if (!resp.ok) return { skip: false, fetchState: null };

    const body = await resp.text();
    const bodyHash = hashBody(body);
    const fetchState: ItemFetchState = {
      etag: resp.headers.get("etag"),
      lastModified: resp.headers.get("last-modified"),
      bodyHash,
    };
    const unchanged = Boolean(existing.lastFetchHash && existing.lastFetchHash === bodyHash);
    return { skip: unchanged, fetchState };
  } catch {
    // Network error — proceed to Firecrawl
    return { skip: false, fetchState: null };
  }
}

/** Checks per-item conditional state and returns skip/fetchState. */
async function checkItemConditional(
  url: string,
  loadFn: DiscoverDeps["loadItemFetchState"]
): Promise<{ skip: boolean; fetchState: ItemFetchState | null }> {
  if (!loadFn) return { skip: false, fetchState: null };
  const existing = await loadFn(url);
  if (!existing) return { skip: false, fetchState: null };
  return conditionalGetItem(url, existing);
}

/** Renders one item via Firecrawl + Claude extraction and returns a draft, or null on failure. */
async function renderAndExtract(
  deps: DiscoverDeps,
  brandId: number,
  url: string,
  fetchState: ItemFetchState | null
): Promise<ItemDraftWithFetchState | null> {
  const render = await deps.firecrawl.render(url);
  await deps.recordUsage({
    provider: "firecrawl",
    unitsUsed: 1,
    unitsKind: "pages",
    estimatedCostUsd: FIRECRAWL_COST_PER_PAGE,
  });
  const result = await extractItemDetail({
    client: deps.anthropic,
    brandId,
    sourceUrl: url,
    markdown: render.markdown,
    screenshotPng: render.screenshotBytes,
  });
  await deps.recordUsage({
    provider: "anthropic",
    unitsUsed: result.usage.inputTokens + result.usage.outputTokens,
    unitsKind: "tokens",
    estimatedCostUsd: estimateAnthropicCost(result.usage, MODEL_SONNET),
  });
  return result.confidence >= 0.3 ? { ...result.draft, fetchState } : null;
}

/** Sitemap fallback: fetch per-item pages, skip unchanged ones via cheap conditional GET. */
async function processSitemapItems(
  deps: DiscoverDeps,
  brandId: number,
  urls: string[]
): Promise<ItemDraftWithFetchState[]> {
  const drafts: ItemDraftWithFetchState[] = [];
  for (const url of urls) {
    await deps.rateLimiter.wait(hostnameOf(url));
    deps.rateLimiter.record(hostnameOf(url));
    try {
      const { skip, fetchState } = await checkItemConditional(url, deps.loadItemFetchState);
      if (skip) continue;
      const draft = await renderAndExtract(deps, brandId, url, fetchState);
      if (draft) drafts.push(draft);
    } catch {
      // Skip individual item failures; continue.
    }
  }
  return drafts;
}

export async function discoverBrandCatalog(
  deps: DiscoverDeps,
  input: DiscoverInput
): Promise<DiscoverResult> {
  const conditional = input.catalogConditional;

  // 1. Try Shopify first
  const shopifyResult = await deps.shopify.tryFetch(input.brandPrimaryUrl, conditional);
  if (shopifyResult !== null) {
    if (shopifyResult.kind === "unchanged") {
      return { source: "shopify", unchanged: true, catalogFetchState: null, drafts: [] };
    }
    const rawDrafts = parseShopifyProductsJson(shopifyResult.payload, {
      brandId: input.brandId,
      brandHost: hostnameOf(input.brandPrimaryUrl),
    });
    const catalogFetchState: ItemFetchState = {
      etag: shopifyResult.etag,
      lastModified: shopifyResult.lastModified,
      bodyHash: shopifyResult.bodyHash,
    };
    // Shopify path: no per-item conditional GETs needed (entire catalog in one call)
    const drafts: ItemDraftWithFetchState[] = rawDrafts.map((d) => ({ ...d, fetchState: null }));
    return { source: "shopify", catalogFetchState, drafts };
  }

  // 2. Fall back to sitemap → Firecrawl per item → Claude extract
  const sitemapResult = await deps.sitemap.discover(input.brandPrimaryUrl, conditional);
  if (sitemapResult.kind === "unchanged") {
    return { source: "sitemap", unchanged: true, catalogFetchState: null, drafts: [] };
  }

  const { payload: productUrls, etag, lastModified, bodyHash } = sitemapResult;
  const catalogFetchState: ItemFetchState | null =
    bodyHash === "" ? null : { etag, lastModified, bodyHash };

  if (productUrls.length === 0) {
    return { source: "none", catalogFetchState, drafts: [] };
  }

  const cap = input.maxSitemapItems ?? 50;
  const urls = productUrls.slice(0, cap);
  const drafts = await processSitemapItems(deps, input.brandId, urls);
  return { source: "sitemap", catalogFetchState, drafts };
}
