import { Elysia, type AnyElysia } from "elysia";
import { and, eq, gte } from "drizzle-orm";
import type { DB } from "../infrastructure/db";
import { brandScoreSnapshots } from "../infrastructure/db/schema";
import { jsonWithCaching, lookupBrand } from "./response-helpers";

export function scoreHistoryRoute(args: { db: DB }): AnyElysia {
  return new Elysia().get("/api/v1/brands/:slug/score-history", async ({ params, request }) => {
    const url = new URL(request.url);
    const since = url.searchParams.get("since");
    const brandOrResponse = await lookupBrand(args.db, params.slug);
    if (brandOrResponse instanceof Response) return brandOrResponse;
    const brand = brandOrResponse;
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
