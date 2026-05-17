import type { brandItems } from "../../infrastructure/db/schema";

type BrandItem = typeof brandItems.$inferSelect;

const STANDARD_SIZE_LABELS = new Set(["XS", "S", "M", "L", "XL"]);
const EXTENDED_SIZE_LABELS = new Set(["XXL", "2XL", "3XL", "4XL", "5XL", "XXXL"]);

interface SetsAtSize {
  categories: Set<string>;
  flagshipCount: number;
  midCount: number;
  basicCount: number;
  totalItems: number;
}

function collectByAvailability(items: readonly BrandItem[], labels: Set<string>): SetsAtSize {
  const r: SetsAtSize = {
    categories: new Set(),
    flagshipCount: 0,
    midCount: 0,
    basicCount: 0,
    totalItems: 0,
  };
  for (const item of items) {
    if (item.isDiscontinued) continue;
    const perSize = item.perSizeDataJson;
    const hasAvailable = Object.entries(perSize).some(
      ([size, info]) => labels.has(size.toUpperCase()) && (info as { available: boolean }).available
    );
    if (!hasAvailable) continue;
    r.totalItems++;
    r.categories.add(item.category);
    switch (item.tierClassification) {
      case "flagship": {
        r.flagshipCount++;
        break;
      }
      case "mid": {
        r.midCount++;
        break;
      }
      case "basic": {
        r.basicCount++;
        break;
      }
      default: {
        break;
      }
    }
  }
  return r;
}

export interface RangeParityResult {
  score: number; // 0-10
  categoryParity: number; // 0-10
  tierParity: number; // 0-10
  rawCounts: { standard: SetsAtSize; extended: SetsAtSize };
}

export function scoreRangeParity(items: readonly BrandItem[]): RangeParityResult {
  const standard = collectByAvailability(items, STANDARD_SIZE_LABELS);
  const extended = collectByAvailability(items, EXTENDED_SIZE_LABELS);

  // Category parity: ratio of extended categories vs standard categories.
  const cp =
    standard.categories.size === 0 ? 0 : extended.categories.size / standard.categories.size;
  const categoryParity = Math.min(10, cp * 10);

  // Tier parity: weighted ratio of extended flagship+mid coverage vs standard.
  const stdWeighted = standard.flagshipCount * 2 + standard.midCount;
  const extWeighted = extended.flagshipCount * 2 + extended.midCount;
  const tp = stdWeighted === 0 ? 0 : extWeighted / stdWeighted;
  const tierParity = Math.min(10, tp * 10);

  return {
    score: (categoryParity + tierParity) / 2,
    categoryParity,
    tierParity,
    rawCounts: { standard, extended },
  };
}
