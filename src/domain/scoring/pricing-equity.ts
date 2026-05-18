import type { brandItems } from "../../infrastructure/db/schema";

type BrandItem = typeof brandItems.$inferSelect;
interface SizeInfo {
  price?: number;
  available?: boolean;
}

const STANDARD = new Set(["XS", "S", "M", "L", "XL"]);
const EXTENDED = new Set(["XXL", "2XL", "3XL", "4XL", "5XL", "XXXL"]);

function collectPrices(item: BrandItem): { stdPrices: number[]; extPrices: number[] } {
  const stdPrices: number[] = [];
  const extPrices: number[] = [];
  for (const [size, info] of Object.entries(item.perSizeDataJson) as [string, SizeInfo][]) {
    if (info.price === undefined || info.available !== true) continue;
    if (STANDARD.has(size.toUpperCase())) stdPrices.push(info.price);
    else if (EXTENDED.has(size.toUpperCase())) extPrices.push(info.price);
  }
  return { stdPrices, extPrices };
}

export function scorePricingEquity(items: readonly BrandItem[]): number {
  // Per item: compute median std-size price and median ext-size price. Ratio ext/std reveals upcharge.
  const ratios: number[] = [];
  for (const item of items) {
    if (item.isDiscontinued) continue;
    const { stdPrices, extPrices } = collectPrices(item);
    if (stdPrices.length === 0 || extPrices.length === 0) continue;
    const stdMed = median(stdPrices);
    const extMed = median(extPrices);
    if (stdMed === 0) continue;
    ratios.push(extMed / stdMed);
  }
  if (ratios.length === 0) return 5; // no signal → neutral
  const meanRatio = ratios.reduce((s, v) => s + v, 0) / ratios.length;
  // ratio 1.0 → score 10 (perfect equity). ratio 1.2 (20% upcharge) → ~6. ratio 1.5 → 0.
  return Math.max(0, Math.min(10, 10 - (meanRatio - 1) * 20));
}

// jscpd:ignore-start — identical median helper required inline per scoring module conventions
function median(values: number[]): number {
  const sorted = [...values].toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}
// jscpd:ignore-end
