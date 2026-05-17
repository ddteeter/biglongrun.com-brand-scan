import type { brandItems } from "../../../src/infrastructure/db/schema";

export type BrandItem = typeof brandItems.$inferSelect;

export function makeItem(
  overrides: Partial<BrandItem> & { perSizeDataJson: BrandItem["perSizeDataJson"] }
): BrandItem {
  return {
    id: 1,
    brandId: 1,
    externalId: null,
    sourceUrl: "https://example.com/item",
    name: "Test Item",
    category: "tops",
    tierClassification: "mid",
    tierInferredBy: null,
    tierRationale: null,
    basePriceUsd: null,
    firstSeenAt: "2024-01-01T00:00:00.000Z",
    lastVerifiedAt: "2024-01-01T00:00:00.000Z",
    isDiscontinued: false,
    discontinuedAt: null,
    ...overrides,
  };
}
