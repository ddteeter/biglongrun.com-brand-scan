import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import type { JobHandler } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import {
  brandSizeChartVersions,
  cohortSummaries,
  brandScoreHistory,
  brands,
} from "../infrastructure/db/schema";
import {
  scoreBreadth,
  scoreAccuracy,
  computeComposite,
  promoteSnapshotIfWarranted,
  SCORING_CONFIG_VERSION,
  type CohortSummaryJson,
} from "../domain/scoring";
import type { CanonicalSizeChart } from "../domain/extraction";

const PayloadSchema = z.object({ brandId: z.number().int().positive() });

export function makeScoreBrandHandler(args: { db: DB }): JobHandler {
  return async (rawPayload) => {
    const { brandId } = PayloadSchema.parse(rawPayload);

    const [brand] = await args.db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
    if (!brand?.currentSizeChartVersionId) return;

    const [version] = await args.db
      .select()
      .from(brandSizeChartVersions)
      .where(eq(brandSizeChartVersions.id, brand.currentSizeChartVersionId))
      .limit(1);
    if (!version) return;

    const [cohort] = await args.db
      .select()
      .from(cohortSummaries)
      .orderBy(desc(cohortSummaries.computedAt))
      .limit(1);
    if (!cohort) return;

    const chart = version.sizeChartJson as unknown as CanonicalSizeChart;
    const summary = cohort.summaryJson as unknown as CohortSummaryJson;

    const dimensionScores = {
      size_range_breadth: scoreBreadth(chart, summary),
      measurement_accuracy: scoreAccuracy(chart, summary),
      range_parity: null,
      pricing_equity: null,
      colorway_equity: null,
    } as const;
    const composite = computeComposite(dimensionScores);

    const [history] = await args.db
      .insert(brandScoreHistory)
      .values({
        brandId,
        scoringConfigVersion: SCORING_CONFIG_VERSION,
        cohortSummaryId: cohort.id,
        scoresJson: { ...dimensionScores, composite },
        inputsJson: { sizeChartVersionId: version.id },
      })
      .returning();

    if (!history) throw new Error("Failed to insert brand score history");

    await promoteSnapshotIfWarranted({
      db: args.db,
      brandId,
      latestHistoryId: history.id,
      cohortSummaryId: cohort.id,
      cohortBrandCount: cohort.brandCount,
    });
  };
}
