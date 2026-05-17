export type Tier = "flagship" | "mid" | "basic" | "unclassified";

export interface TierResult {
  tier: Tier;
  reason: string;
}

export interface TierBuckets {
  basicMax: number;
  flagshipMin: number;
  cohortSize: number;
}

const MIN_COHORT_FOR_HEURISTIC = 4;
const BASIC_PERCENTILE = 0.25;
const FLAGSHIP_PERCENTILE = 0.75;

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor((sorted.length - 1) * p);
  const v = sorted[idx];
  if (v === undefined) throw new Error("empty cohort");
  return v;
}

export function computeBuckets(cohortPrices: number[]): TierBuckets | null {
  const priced = cohortPrices.filter((p) => Number.isFinite(p) && p > 0);
  if (priced.length < MIN_COHORT_FOR_HEURISTIC) return null;
  const sorted = priced.toSorted((a, b) => a - b);
  return {
    basicMax: percentile(sorted, BASIC_PERCENTILE),
    flagshipMin: percentile(sorted, FLAGSHIP_PERCENTILE),
    cohortSize: priced.length,
  };
}

export function classifyByPricePercentile(
  price: number | null,
  cohortPrices: number[]
): TierResult {
  if (price === null || !Number.isFinite(price) || price <= 0) {
    return { tier: "unclassified", reason: "no price" };
  }
  const buckets = computeBuckets(cohortPrices);
  if (!buckets) return { tier: "unclassified", reason: "cohort too small" };
  if (price <= buckets.basicMax)
    return {
      tier: "basic",
      reason: `price ${String(price)} <= basic cap ${String(buckets.basicMax)}`,
    };
  if (price >= buckets.flagshipMin)
    return {
      tier: "flagship",
      reason: `price ${String(price)} >= flagship floor ${String(buckets.flagshipMin)}`,
    };
  return {
    tier: "mid",
    reason: `price ${String(price)} between ${String(buckets.basicMax)} and ${String(buckets.flagshipMin)}`,
  };
}
