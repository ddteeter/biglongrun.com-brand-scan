import { Elysia, type AnyElysia } from "elysia";
import { eq } from "drizzle-orm";
import type { DB } from "../infrastructure/db";
import { brands, brandSizeChartVersions } from "../infrastructure/db/schema";
import { jsonWithCaching, lookupBrand } from "./response-helpers";

export function brandsRoute(args: { db: DB }): AnyElysia {
  return new Elysia()
    .get("/api/v1/brands", async ({ request }) => {
      const url = new URL(request.url);
      const category = url.searchParams.get("category");
      const pageSize = 50;
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
      const rows = await args.db
        .select({
          slug: brands.slug,
          name: brands.name,
          categoryTag: brands.categoryTag,
          primaryUrl: brands.primaryUrl,
          updatedAt: brands.updatedAt,
        })
        .from(brands)
        .where(category ? eq(brands.categoryTag, category) : undefined)
        .orderBy(brands.name)
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return jsonWithCaching(JSON.stringify({ page, pageSize, brands: rows }), request);
    })
    .get("/api/v1/brands/:slug", async ({ params, request }) => {
      const brandOrResponse = await lookupBrand(args.db, params.slug);
      if (brandOrResponse instanceof Response) return brandOrResponse;
      const brand = brandOrResponse;
      let chart: { id: number } | undefined;
      if (brand.currentSizeChartVersionId) {
        const [v] = await args.db
          .select({ id: brandSizeChartVersions.id })
          .from(brandSizeChartVersions)
          .where(eq(brandSizeChartVersions.id, brand.currentSizeChartVersionId))
          .limit(1);
        chart = v;
      }
      return jsonWithCaching(
        JSON.stringify({
          slug: brand.slug,
          name: brand.name,
          primaryUrl: brand.primaryUrl,
          categoryTag: brand.categoryTag,
          audienceTags: brand.audienceTags,
          divergenceFlag: brand.divergenceFlag,
          hasCurrentSizeChart: chart != null,
          updatedAt: brand.updatedAt,
        }),
        request
      );
    });
}
