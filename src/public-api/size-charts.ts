import { Elysia, type AnyElysia } from "elysia";
import { eq } from "drizzle-orm";
import type { DB } from "../infrastructure/db";
import { brands, brandSizeChartVersions } from "../infrastructure/db/schema";
import { problemDetailsResponse, ProblemTypes } from "../infrastructure/http";
import { jsonWithCaching } from "./response-helpers";

export function sizeChartsRoute(args: { db: DB }): AnyElysia {
  return new Elysia().get("/api/v1/brands/:slug/size-chart", async ({ params, request }) => {
    const [brand] = await args.db
      .select()
      .from(brands)
      .where(eq(brands.slug, params.slug))
      .limit(1);
    if (!brand?.currentSizeChartVersionId) {
      return problemDetailsResponse({
        type: ProblemTypes.NotFound,
        title: "Not Found",
        status: 404,
        detail: `No accepted size chart for ${params.slug}`,
      });
    }
    const [v] = await args.db
      .select()
      .from(brandSizeChartVersions)
      .where(eq(brandSizeChartVersions.id, brand.currentSizeChartVersionId))
      .limit(1);
    if (!v) {
      return problemDetailsResponse({
        type: ProblemTypes.NotFound,
        title: "Not Found",
        status: 404,
        detail: `Inconsistent state: current version pointer dangling`,
      });
    }
    return jsonWithCaching(JSON.stringify(v.sizeChartJson), request);
  });
}
