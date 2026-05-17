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

export class SitemapCatalogDiscoverer {
  constructor(private readonly fetchFn: typeof globalThis.fetch = globalThis.fetch) {}

  async discover(brandPrimaryUrl: string): Promise<string[]> {
    const u = new URL(brandPrimaryUrl);
    const root = `https://${u.host}/sitemap.xml`;
    const results = await this.discoverFrom(root);
    return [...new Set(results)];
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
    return locs.filter((url) => isProductUrl(url));
  }
}
