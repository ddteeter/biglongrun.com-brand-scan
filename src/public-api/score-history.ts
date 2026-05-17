import { Elysia, type AnyElysia } from "elysia";
import { and, eq, gte } from "drizzle-orm";
import type { DB } from "../infrastructure/db";
import { brands, brandScoreSnapshots } from "../infrastructure/db/schema";
import { problemDetailsResponse, ProblemTypes } from "../infrastructure/http";
import { jsonWithCaching } from "./response-helpers";

export function scoreHistoryRoute(args: { db: DB }): AnyElysia {
  return new Elysia().get("/api/v1/brands/:slug/score-history", async ({ params, request }) => {
    const url = new URL(request.url);
    const since = url.searchParams.get("since");
    const [brand] = await args.db
      .select()
      .from(brands)
      .where(eq(brands.slug, params.slug))
      .limit(1);
    if (!brand) {
      return problemDetailsResponse({
        type: ProblemTypes.NotFound,
        title: "Not Found",
        status: 404,
        detail: `No brand with slug ${params.slug}`,
      });
    }
    const conditions = [
      eq(brandScoreSnapshots.brandId, brand.id),
      eq(brandScoreSnapshots.isPublic, true),
    ];
    if (since) conditions.push(gte(brandScoreSnapshots.snapshotAt, since));
    const rows = await args.db
      .select({
        snapshotAt: brandScoreSnapshots.snapshotAt,
        scoresJson: brandScoreSnapshots.scoresJson,
      })
      .from(brandScoreSnapshots)
      .where(and(...conditions))
      .orderBy(brandScoreSnapshots.snapshotAt);
    return jsonWithCaching(JSON.stringify({ snapshots: rows }), request);
  });
}
