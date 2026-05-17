export interface RateLimiterOptions {
  minIntervalMs: number;
  now?: () => number;
}

export class DomainRateLimiter {
  private readonly lastAt = new Map<string, number>();
  private readonly minIntervalMs: number;
  private readonly now: () => number;

  constructor(opts: RateLimiterOptions) {
    this.minIntervalMs = opts.minIntervalMs;
    this.now = opts.now ?? (() => Date.now());
  }

  static extractHost(url: string): string {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  }

  nextAvailableAt(host: string): number {
    const last = this.lastAt.get(host);
    if (last === undefined) return this.now();
    const earliest = last + this.minIntervalMs;
    return Math.max(earliest, this.now());
  }

  record(host: string): void {
    this.lastAt.set(host, this.now());
  }

  async wait(host: string): Promise<void> {
    const target = this.nextAvailableAt(host);
    const delay = target - this.now();
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }
}
