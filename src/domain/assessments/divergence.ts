import type { AssessmentRatings } from "./types";
import { DIVERGENCE_FLAG_THRESHOLD } from "../scoring";

export interface DivergenceInput {
  composite: number | null;
  assessmentRatings: AssessmentRatings[];
}

export function computeDivergence(input: DivergenceInput): {
  divergent: boolean;
  gap: number | null;
} {
  if (input.composite === null || input.assessmentRatings.length === 0) {
    return { divergent: false, gap: null };
  }
  const meanOverall =
    input.assessmentRatings.reduce((s, r) => s + r.overall_inclusivity, 0) /
    input.assessmentRatings.length;
  const gap = Math.abs(input.composite - meanOverall);
  return { divergent: gap > DIVERGENCE_FLAG_THRESHOLD, gap };
}
