import { Elysia, type AnyElysia } from "elysia";
import { and, asc, eq } from "drizzle-orm";
import type { DB } from "../infrastructure/db";
import { brandItems } from "../infrastructure/db/schema";
import { jsonWithCaching, lookupBrand } from "./response-helpers";

export function itemsRoute(args: { db: DB }): AnyElysia {
  return new Elysia().get("/api/v1/brands/:slug/items", async ({ params, request }) => {
    const url = new URL(request.url);
    const category = url.searchParams.get("category");
    const includeDiscontinued = url.searchParams.get("include_discontinued") === "true";

    const brandOrResponse = await lookupBrand(args.db, params.slug);
    if (brandOrResponse instanceof Response) return brandOrResponse;
    const brand = brandOrResponse;

    const conditions = [eq(brandItems.brandId, brand.id)];
    if (!includeDiscontinued) conditions.push(eq(brandItems.isDiscontinued, false));
    if (category) conditions.push(eq(brandItems.category, category));

    const rows = await args.db
      .select({
        externalId: brandItems.externalId,
        sourceUrl: brandItems.sourceUrl,
        name: brandItems.name,
        category: brandItems.category,
        tier: brandItems.tierClassification,
        inferredBy: brandItems.tierInferredBy,
        basePriceUsd: brandItems.basePriceUsd,
        perSizeDataJson: brandItems.perSizeDataJson,
        isDiscontinued: brandItems.isDiscontinued,
        firstSeenAt: brandItems.firstSeenAt,
      })
      .from(brandItems)
      .where(and(...conditions))
      .orderBy(asc(brandItems.category), asc(brandItems.name));

    const items = rows.map((r) => ({
      externalId: r.externalId,
      sourceUrl: r.sourceUrl,
      name: r.name,
      category: r.category,
      tier: r.tier,
      inferredBy: r.inferredBy,
      basePriceUsd: r.basePriceUsd,
      perSize: r.perSizeDataJson,
      isDiscontinued: r.isDiscontinued,
      firstSeenAt: r.firstSeenAt,
    }));

    return jsonWithCaching(
      JSON.stringify({ slug: brand.slug, count: items.length, items }),
      request
    );
  });
}
