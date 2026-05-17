import { eq, and } from "drizzle-orm";
import { desc } from "drizzle-orm";
import type { JobHandler } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import { brands, brandSizeChartVersions } from "../infrastructure/db/schema";
import { computeBrandCadence } from "../domain/catalog";

export function makeComputeBrandCadenceHandler(args: { db: DB }): JobHandler {
  return async () => {
    const allBrands = await args.db.select().from(brands).where(eq(brands.active, true));
    for (const brand of allBrands) {
      const versions = await args.db
        .select({ acceptedAt: brandSizeChartVersions.acceptedAt })
        .from(brandSizeChartVersions)
        .where(
          and(
            eq(brandSizeChartVersions.brandId, brand.id),
            eq(brandSizeChartVersions.status, "accepted")
          )
        )
        .orderBy(desc(brandSizeChartVersions.acceptedAt));
      const dates = versions.map((v) => v.acceptedAt).filter((v): v is string => v !== null);
      const result = computeBrandCadence({ acceptedChangeDates: dates });
      await args.db
        .update(brands)
        .set({
          predictedNextChangeAt: result.predictedNextChangeAt,
          cadenceLearnedAt: new Date().toISOString(),
          observedChangeIntervals: result.intervals,
        })
        .where(eq(brands.id, brand.id));
    }
  };
}
