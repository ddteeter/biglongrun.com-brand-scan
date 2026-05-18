import { createHash } from "node:crypto";
import type { ConditionalState, FetchResult } from "./shopify";

const PRODUCT_URL_PATTERNS = [/\/products?\//i, /\/p\//i, /\/shop\//i];

function extractLocs(xml: string): string[] {
  const locs: string[] = [];
  let cursor = 0;
  const openTag = "<loc>";
  const closeTag = "</loc>";
  while (cursor < xml.length) {
    const start = xml.indexOf(openTag, cursor);
    if (start === -1) break;
    const end = xml.indexOf(closeTag, start);
    if (end === -1) break;
    locs.push(xml.slice(start + openTag.length, end).trim());
    cursor = end + closeTag.length;
  }
  return locs;
}

function isSitemapIndex(xml: string): boolean {
  return xml.includes("<sitemapindex");
}

function isProductUrl(url: string): boolean {
  return PRODUCT_URL_PATTERNS.some((p) => p.test(url));
}

export type { ConditionalState, FetchResult } from "./shopify";

function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export class SitemapCatalogDiscoverer {
  constructor(private readonly fetchFn: typeof globalThis.fetch = globalThis.fetch) {}

  async discover(
    brandPrimaryUrl: string,
    conditional?: ConditionalState
  ): Promise<FetchResult<string[]>> {
    const u = new URL(brandPrimaryUrl);
    const root = `https://${u.host}/sitemap.xml`;

    const headers: Record<string, string> = { "user-agent": "brand-scan/1.0" };
    if (conditional?.etag) headers["If-None-Match"] = conditional.etag;
    if (conditional?.lastModified) headers["If-Modified-Since"] = conditional.lastModified;

    const r = await this.fetchFn(root, { headers });

    if (r.status === 304) return { kind: "unchanged" };
    if (!r.ok)
      return { kind: "changed", payload: [], etag: null, lastModified: null, bodyHash: "" };

    const body = await r.text();
    const etag = r.headers.get("etag");
    const lastModified = r.headers.get("last-modified");
    const bodyHash = hashBody(body);

    // Body-hash short-circuit for CDNs that rotate ETags
    if (conditional?.bodyHash && conditional.bodyHash === bodyHash) {
      return { kind: "unchanged" };
    }

    const locs = extractLocs(body);
    if (locs.length === 0) {
      return { kind: "changed", payload: [], etag, lastModified, bodyHash };
    }

    let productUrls: string[];
    if (isSitemapIndex(body)) {
      // Only root call has conditional logic; nested entries are fetched unconditionally
      const nested = await Promise.all(locs.map((loc) => this.discoverFrom(loc)));
      productUrls = nested.flat();
    } else {
      productUrls = locs.filter((u) => isProductUrl(u));
    }

    const unique = [...new Set(productUrls)];
    return { kind: "changed", payload: unique, etag, lastModified, bodyHash };
  }

  private async discoverFrom(url: string): Promise<string[]> {
    const r = await this.fetchFn(url, { headers: { "user-agent": "brand-scan/1.0" } });
    if (!r.ok) return [];
    const text = await r.text();
    const locs = extractLocs(text);
    if (locs.length === 0) return [];
    if (isSitemapIndex(text)) {
      const nested = await Promise.all(locs.map((loc) => this.discoverFrom(loc)));
      return nested.flat();
    }
    return locs.filter((u) => isProductUrl(u));
  }
}
