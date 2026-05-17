import type { CanonicalSizeChart } from "../extraction";
import type { CohortSummaryJson } from "./cohort";

export function scoreBreadth(chart: CanonicalSizeChart, cohort: CohortSummaryJson): number {
  if (cohort.breadthMax === cohort.breadthMin) return 5;
  const ratio =
    (chart.size_labels.length - cohort.breadthMin) / (cohort.breadthMax - cohort.breadthMin);
  return Math.max(0, Math.min(10, ratio * 10));
}
