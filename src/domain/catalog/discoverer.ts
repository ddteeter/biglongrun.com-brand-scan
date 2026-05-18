import type {
  FirecrawlClient,
  AnthropicClient,
  DomainRateLimiter,
} from "../../infrastructure/external";
import { estimateAnthropicCost, MODEL_SONNET } from "../../infrastructure/external";
import { parseShopifyProductsJson, type ShopifyCatalogDiscoverer } from "./shopify";
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
}

export interface DiscoverInput {
  brandId: number;
  brandPrimaryUrl: string;
  maxSitemapItems?: number; // safety cap when falling back to per-item extraction
}

export interface DiscoverResult {
  source: "shopify" | "sitemap" | "none";
  drafts: ItemDraft[];
}

const FIRECRAWL_COST_PER_PAGE = 0;

function hostnameOf(url: string): string {
  return new URL(url).host;
}

export async function discoverBrandCatalog(
  deps: DiscoverDeps,
  input: DiscoverInput
): Promise<DiscoverResult> {
  // 1. Try Shopify first
  const shopifyJson = await deps.shopify.tryFetch(input.brandPrimaryUrl);
  if (shopifyJson !== null) {
    const drafts = parseShopifyProductsJson(shopifyJson, {
      brandId: input.brandId,
      brandHost: hostnameOf(input.brandPrimaryUrl),
    });
    return { source: "shopify", drafts };
  }

  // 2. Fall back to sitemap → Firecrawl per item → Claude extract
  const productUrls = await deps.sitemap.discover(input.brandPrimaryUrl);
  if (productUrls.length === 0) {
    return { source: "none", drafts: [] };
  }
  const cap = input.maxSitemapItems ?? 50;
  const urls = productUrls.slice(0, cap);
  const drafts: ItemDraft[] = [];
  for (const url of urls) {
    await deps.rateLimiter.wait(hostnameOf(url));
    deps.rateLimiter.record(hostnameOf(url));
    try {
      const render = await deps.firecrawl.render(url);
      await deps.recordUsage({
        provider: "firecrawl",
        unitsUsed: 1,
        unitsKind: "pages",
        estimatedCostUsd: FIRECRAWL_COST_PER_PAGE,
      });
      const result = await extractItemDetail({
        client: deps.anthropic,
        brandId: input.brandId,
        sourceUrl: url,
        markdown: render.markdown,
        screenshotPng: render.screenshotBytes,
      });
      const { inputTokens, outputTokens } = result.usage;
      await deps.recordUsage({
        provider: "anthropic",
        unitsUsed: inputTokens + outputTokens,
        unitsKind: "tokens",
        estimatedCostUsd: estimateAnthropicCost(result.usage, MODEL_SONNET),
      });
      if (result.confidence >= 0.3) drafts.push(result.draft);
    } catch {
      // Skip individual item failures; continue.
    }
  }
  return { source: "sitemap", drafts };
}
