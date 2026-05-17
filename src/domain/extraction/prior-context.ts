import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brandSizeChartVersions } from "../../infrastructure/db/schema";
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

  // Assessments and corrections are added in phases 3 and 6.x respectively; stubbed for phase 1.
  return {
    lastAccepted,
    assessments: [],
    corrections: [],
  };
}
