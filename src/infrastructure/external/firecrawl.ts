export interface FirecrawlOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}

export interface ConditionalRequest {
  etag?: string;
  lastModified?: string;
}

export type HeadResult =
  | { kind: "unchanged" }
  | { kind: "changed"; body: string; etag: string | null; lastModified: string | null };

export interface RenderResult {
  markdown: string;
  screenshotBytes: Uint8Array;
  screenshotUrl: string;
}

interface FirecrawlScrapeResponse {
  success: boolean;
  error?: string;
  data?: { markdown?: string; screenshot?: string };
}

export class FirecrawlClient {
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly baseUrl: string;
  constructor(private readonly opts: FirecrawlOptions) {
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.baseUrl = opts.baseUrl ?? "https://api.firecrawl.dev";
  }

  async headOnly(url: string, conditional: ConditionalRequest): Promise<HeadResult> {
    const headers: Record<string, string> = {
      "user-agent": "brand-scan/1.0 (+https://biglongrun.com)",
    };
    if (conditional.etag) headers["If-None-Match"] = conditional.etag;
    if (conditional.lastModified) headers["If-Modified-Since"] = conditional.lastModified;

    const r = await this.fetchFn(url, { method: "GET", headers });
    if (r.status === 304) return { kind: "unchanged" };
    if (!r.ok) throw new Error(`HEAD ${url} failed: ${String(r.status)}`);
    const body = await r.text();
    return {
      kind: "changed",
      body,
      etag: r.headers.get("etag"),
      lastModified: r.headers.get("last-modified"),
    };
  }

  async render(url: string): Promise<RenderResult> {
    const r = await this.fetchFn(`${this.baseUrl}/v1/scrape`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown", "screenshot"],
      }),
    });
    const json = (await r.json()) as FirecrawlScrapeResponse;
    if (!r.ok || !json.success) {
      throw new Error(`Firecrawl scrape failed: ${json.error ?? r.statusText}`);
    }
    const md = json.data?.markdown ?? "";
    const screenshotUrl = json.data?.screenshot;
    if (!screenshotUrl) throw new Error("Firecrawl did not return a screenshot URL");
    const sr = await this.fetchFn(screenshotUrl);
    if (!sr.ok) throw new Error(`Failed to download screenshot: ${String(sr.status)}`);
    const screenshotBytes = new Uint8Array(await sr.arrayBuffer());
    return { markdown: md, screenshotBytes, screenshotUrl };
  }
}
