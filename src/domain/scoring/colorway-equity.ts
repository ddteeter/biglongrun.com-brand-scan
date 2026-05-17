import type { brandItems } from "../../infrastructure/db/schema";

type BrandItem = typeof brandItems.$inferSelect;

interface SizeInfo {
  available?: boolean;
  colors?: string[];
}

const STANDARD = new Set(["XS", "S", "M", "L", "XL"]);
const EXTENDED = new Set(["XXL", "2XL", "3XL", "4XL", "5XL", "XXXL"]);

function targetColorSet(
  size: string,
  stdColors: Set<string>,
  extColors: Set<string>
): Set<string> | null {
  const upper = size.toUpperCase();
  if (STANDARD.has(upper)) return stdColors;
  if (EXTENDED.has(upper)) return extColors;
  return null;
}

function collectItemColorRatio(item: BrandItem): number | null {
  const stdColors = new Set<string>();
  const extColors = new Set<string>();
  for (const [size, info] of Object.entries(item.perSizeDataJson) as [string, SizeInfo][]) {
    if (info.available !== true || !info.colors) continue;
    const target = targetColorSet(size, stdColors, extColors);
    if (!target) continue;
    for (const c of info.colors) target.add(c.toLowerCase());
  }
  if (stdColors.size === 0 || extColors.size === 0) return null;
  return extColors.size / stdColors.size;
}

export function scoreColorwayEquity(items: readonly BrandItem[]): number {
  const ratios: number[] = [];
  for (const item of items) {
    if (item.isDiscontinued) continue;
    const ratio = collectItemColorRatio(item);
    if (ratio !== null) ratios.push(ratio);
  }
  if (ratios.length === 0) return 5;
  const meanRatio = ratios.reduce((s, v) => s + v, 0) / ratios.length;
  return Math.max(0, Math.min(10, meanRatio * 10));
}
