export const SCORING_CONFIG_VERSION = "v1.0";

export const WEIGHTS = {
  size_range_breadth: 0.25,
  measurement_accuracy: 0.2,
  range_parity: 0.3, // null in phase 1
  pricing_equity: 0.15, // null in phase 1
  colorway_equity: 0.1, // null in phase 1
} as const;

export type ScoreDimension = keyof typeof WEIGHTS;

export const SNAPSHOT_PROMOTION_DELTA = 0.5;
export const MIN_COHORT_SIZE_FOR_PUBLIC = 5;
export const DIVERGENCE_FLAG_THRESHOLD = 2;
export const SUSTAINED_DIRECTION_WINDOW = 3;
export const SNAPSHOT_HEARTBEAT_DAYS = 90;
