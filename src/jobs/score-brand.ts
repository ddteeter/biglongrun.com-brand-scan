import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { JobHandler } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import {
  brands,
  brandSizeChartVersions,
  brandScoreHistory,
  cohortSummaries,
  brandItems,
  authorBrandAssessments,
} from "../infrastructure/db/schema";
import {
  scoreBreadth,
  scoreAccuracy,
  computeComposite,
  promoteSnapshotIfWarranted,
  SCORING_CONFIG_VERSION,
  type CohortSummaryJson,
} from "../domain/scoring";
import { scoreRangeParity } from "../domain/scoring/range-parity";
import { scorePricingEquity } from "../domain/scoring/pricing-equity";
import { scoreColorwayEquity } from "../domain/scoring/colorway-equity";
import type { CanonicalSizeChart } from "../domain/extraction";
import { computeDivergence } from "../domain/assessments";

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

    const items = await args.db
      .select()
      .from(brandItems)
      .where(and(eq(brandItems.brandId, brandId), eq(brandItems.isDiscontinued, false)));

    const rangeParityResult = scoreRangeParity(items);

    const dimensionScores = {
      size_range_breadth: scoreBreadth(chart, summary),
      measurement_accuracy: scoreAccuracy(chart, summary),
      range_parity: items.length > 0 ? rangeParityResult.score : null,
      pricing_equity: items.length > 0 ? scorePricingEquity(items) : null,
      colorway_equity: items.length > 0 ? scoreColorwayEquity(items) : null,
    } as const;
    const composite = computeComposite(dimensionScores);

    // Wrap history insert + snapshot promotion in a transaction so snapshot always
    // points to a committed history row (partial failure would leave an orphaned pointer).
    await args.db.transaction(async (tx) => {
      const [history] = await tx
        .insert(brandScoreHistory)
        .values({
          brandId,
          scoringConfigVersion: SCORING_CONFIG_VERSION,
          cohortSummaryId: cohort.id,
          scoresJson: { ...dimensionScores, composite },
          inputsJson: {
            sizeChartVersionId: version.id,
            itemCount: items.length,
            rangeParityBreakdown: {
              categoryParity: rangeParityResult.categoryParity,
              tierParity: rangeParityResult.tierParity,
            },
          },
        })
        .returning();

      if (!history) throw new Error("Failed to insert brand score history");

      await promoteSnapshotIfWarranted({
        db: tx,
        brandId,
        latestHistoryId: history.id,
        cohortSummaryId: cohort.id,
        cohortBrandCount: cohort.brandCount,
      });

      const assessmentRows = await tx
        .select({ ratingsJson: authorBrandAssessments.ratingsJson })
        .from(authorBrandAssessments)
        .where(eq(authorBrandAssessments.brandId, brandId));

      const divergence = computeDivergence({
        composite,
        assessmentRatings: assessmentRows.map((a) => a.ratingsJson),
      });

      await tx
        .update(brands)
        .set({ divergenceFlag: divergence.divergent })
        .where(eq(brands.id, brandId));
    });
  };
}
