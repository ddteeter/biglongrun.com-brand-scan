export * from "./config";
export {
  recomputeCohortSummary,
  type CohortSummaryJson,
  type CohortSummaryPerSize,
  type RecomputeOptions,
} from "./cohort";
export { scoreBreadth } from "./breadth";
export { scoreAccuracy } from "./accuracy";
export { scoreRangeParity, type RangeParityResult } from "./range-parity";
export { scorePricingEquity } from "./pricing-equity";
export { scoreColorwayEquity } from "./colorway-equity";
export { computeComposite, type DimensionScores } from "./composite";
export { promoteSnapshotIfWarranted, type PromoteOptions, type PromoteResult } from "./snapshot";
