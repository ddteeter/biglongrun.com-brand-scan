import type { CanonicalSizeChart } from "./canonical";

export interface CohortSummary {
  perSize: Record<
    string,
    {
      chestMedian: number;
      waistMedian: number;
      hipMedian: number;
      chestStdDev: number;
      waistStdDev: number;
      hipStdDev: number;
    }
  >;
}

const OUTLIER_PENALTY_PER_DIM = 0.1;

export function cohortOutlierFactor(
  chart: CanonicalSizeChart,
  cohort: CohortSummary | null
): number {
  if (!cohort) return 1;
  let penalty = 0;
  for (const label of chart.size_labels) {
    const m = chart.measurements[label];
    const c = cohort.perSize[label];
    if (!m || !c) continue;
    const chestMid = (m.chest_in[0] + m.chest_in[1]) / 2;
    const waistMid = (m.waist_in[0] + m.waist_in[1]) / 2;
    const hipMid = (m.hip_in[0] + m.hip_in[1]) / 2;
    const chestZ = Math.abs((chestMid - c.chestMedian) / (c.chestStdDev || 1));
    const waistZ = Math.abs((waistMid - c.waistMedian) / (c.waistStdDev || 1));
    const hipZ = Math.abs((hipMid - c.hipMedian) / (c.hipStdDev || 1));
    if (chestZ > 3) penalty += OUTLIER_PENALTY_PER_DIM;
    if (waistZ > 3) penalty += OUTLIER_PENALTY_PER_DIM;
    if (hipZ > 3) penalty += OUTLIER_PENALTY_PER_DIM;
  }
  return Math.max(0, 1 - penalty);
}
