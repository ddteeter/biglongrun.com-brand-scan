import { WEIGHTS, type ScoreDimension } from "./config";

export type DimensionScores = Record<ScoreDimension, number | null>;

export function computeComposite(scores: DimensionScores): number | null {
  let numerator = 0;
  let denominator = 0;
  for (const [dim, score] of Object.entries(scores) as [ScoreDimension, number | null][]) {
    if (score === null) continue;
    const w = WEIGHTS[dim];
    numerator += w * score;
    denominator += w;
  }
  if (denominator === 0) return null;
  return numerator / denominator;
}
