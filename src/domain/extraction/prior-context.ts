import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brandSizeChartVersions, authorBrandAssessments } from "../../infrastructure/db/schema";
import type { CanonicalSizeChart } from "./canonical";
import type { PriorContext } from "./extractor-claude";

export async function assemblePriorContext(db: DB, brandId: number): Promise<PriorContext> {
  const [last] = await db
    .select()
    .from(brandSizeChartVersions)
    .where(
      and(
        eq(brandSizeChartVersions.brandId, brandId),
        eq(brandSizeChartVersions.status, "accepted")
      )
    )
    .orderBy(desc(brandSizeChartVersions.extractedAt))
    .limit(1);

  const lastAccepted = (last?.sizeChartJson as CanonicalSizeChart | undefined) ?? null;

  const assessmentRows = await db
    .select()
    .from(authorBrandAssessments)
    .where(eq(authorBrandAssessments.brandId, brandId))
    .orderBy(desc(authorBrandAssessments.assessmentDate))
    .limit(5);

  const assessments = assessmentRows.map((row) => ({
    authorSlug: row.authorSlug,
    assessmentDate: row.assessmentDate,
    ratings: row.ratingsJson as unknown as Record<string, number>,
    proseMarkdown: row.proseMarkdown,
  }));

  return {
    lastAccepted,
    assessments,
    corrections: [],
  };
}
