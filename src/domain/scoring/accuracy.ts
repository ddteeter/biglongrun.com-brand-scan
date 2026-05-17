import type { CanonicalSizeChart } from "../extraction";
import type { CohortSummaryJson } from "./cohort";

const MAX_TOLERATED_DEVIATION_IN = 5;

export function scoreAccuracy(chart: CanonicalSizeChart, cohort: CohortSummaryJson): number {
  const deviations: number[] = [];
  for (const label of chart.size_labels) {
    const m = chart.measurements[label];
    const c = cohort.perSize[label];
    if (!m || !c) continue;
    const chestMid = (m.chest_in[0] + m.chest_in[1]) / 2;
    const waistMid = (m.waist_in[0] + m.waist_in[1]) / 2;
    const hipMid = (m.hip_in[0] + m.hip_in[1]) / 2;
    deviations.push(
      Math.abs(chestMid - c.chestMedian),
      Math.abs(waistMid - c.waistMedian),
      Math.abs(hipMid - c.hipMedian)
    );
  }
  if (deviations.length === 0) return 5;
  const meanDev = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  const normalized = Math.min(1, meanDev / MAX_TOLERATED_DEVIATION_IN);
  return Math.max(0, 10 * (1 - normalized));
}
