export interface ChangeEventInput {
  changeType: "added" | "discontinued" | "tier_reclassified" | "size_added" | "price_changed";
  changedAt: string; // ISO
}

export interface DeltaSummary {
  added: number;
  discontinued: number;
  reclassified: number;
  sizeAdded: number;
  priceChanged: number;
  totalRecent: number;
  isQuietPeriod: boolean;
}

export interface SummarizeOptions {
  now: Date;
  withinDays: number;
}

export function summarizeCatalogDeltas(
  events: ChangeEventInput[],
  opts: SummarizeOptions
): DeltaSummary {
  const cutoffMs = opts.now.getTime() - opts.withinDays * 86_400_000;
  const recent = events.filter((e) => new Date(e.changedAt).getTime() >= cutoffMs);
  const counts = {
    added: 0,
    discontinued: 0,
    reclassified: 0,
    sizeAdded: 0,
    priceChanged: 0,
  };
  for (const e of recent) {
    switch (e.changeType) {
      case "added": {
        counts.added++;
        break;
      }
      case "discontinued": {
        counts.discontinued++;
        break;
      }
      case "tier_reclassified": {
        counts.reclassified++;
        break;
      }
      case "size_added": {
        counts.sizeAdded++;
        break;
      }
      case "price_changed": {
        counts.priceChanged++;
        break;
      }
    }
  }
  return {
    ...counts,
    totalRecent: recent.length,
    isQuietPeriod: recent.length === 0,
  };
}
