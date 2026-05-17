import { eq, isNotNull } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brands, brandSizeChartVersions, cohortSummaries } from "../../infrastructure/db/schema";
import type { CanonicalSizeChart } from "../extraction";
import { SCORING_CONFIG_VERSION } from "./config";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 1;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) || 1;
}

export interface CohortSummaryPerSize {
  chestMedian: number;
  waistMedian: number;
  hipMedian: number;
  chestStdDev: number;
  waistStdDev: number;
  hipStdDev: number;
}

export interface CohortSummaryJson {
  perSize: Record<string, CohortSummaryPerSize>;
  breadths: number[]; // size_label counts across the cohort
  breadthMedian: number;
  breadthMin: number;
  breadthMax: number;
}

export interface RecomputeOptions {
  db: DB;
  trigger: "scheduled" | "manual" | "data_threshold";
}

export async function recomputeCohortSummary(opts: RecomputeOptions): Promise<number> {
  const rows = await opts.db
    .select({ chart: brandSizeChartVersions.sizeChartJson })
    .from(brands)
    .innerJoin(
      brandSizeChartVersions,
      eq(brands.currentSizeChartVersionId, brandSizeChartVersions.id)
    )
    .where(isNotNull(brands.currentSizeChartVersionId));

  interface SizeCollect {
    chest: number[];
    waist: number[];
    hip: number[];
  }
  const perSizeCollect = new Map<string, SizeCollect>();
  const breadths: number[] = [];
  for (const r of rows) {
    const chart = r.chart as unknown as CanonicalSizeChart;
    breadths.push(chart.size_labels.length);
    for (const label of chart.size_labels) {
      const m = chart.measurements[label];
      if (!m) continue;
      const existing = perSizeCollect.get(label);
      const entry: SizeCollect = existing ?? { chest: [], waist: [], hip: [] };
      if (!existing) perSizeCollect.set(label, entry);
      entry.chest.push((m.chest_in[0] + m.chest_in[1]) / 2);
      entry.waist.push((m.waist_in[0] + m.waist_in[1]) / 2);
      entry.hip.push((m.hip_in[0] + m.hip_in[1]) / 2);
    }
  }

  const perSize: Record<string, CohortSummaryPerSize> = {};
  for (const [label, vals] of perSizeCollect.entries()) {
    perSize[label] = {
      chestMedian: median(vals.chest),
      waistMedian: median(vals.waist),
      hipMedian: median(vals.hip),
      chestStdDev: stdDev(vals.chest),
      waistStdDev: stdDev(vals.waist),
      hipStdDev: stdDev(vals.hip),
    };
  }
  const sortedBreadths = [...breadths].toSorted((a, b) => a - b);
  const summary: CohortSummaryJson = {
    perSize,
    breadths,
    breadthMedian: median(breadths),
    breadthMin: sortedBreadths.at(0) ?? 0,
    breadthMax: sortedBreadths.at(-1) ?? 0,
  };

  const [row] = await opts.db
    .insert(cohortSummaries)
    .values({
      scoringConfigVersion: SCORING_CONFIG_VERSION,
      brandCount: rows.length,
      summaryJson: summary as unknown as Record<string, unknown>,
      trigger: opts.trigger,
    })
    .returning();

  if (!row) throw new Error("Failed to insert cohort summary");
  return row.id;
}
