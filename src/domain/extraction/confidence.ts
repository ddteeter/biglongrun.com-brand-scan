export interface ConfidenceInputs {
  claudeReported: number;
  structuralValidation: number;
  cohortOutlier: number;
}

export interface ConfidenceResult {
  composite: number;
  breakdown: ConfidenceInputs;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function compositeConfidence(inputs: ConfidenceInputs): ConfidenceResult {
  const composite =
    clamp01(inputs.claudeReported) *
    clamp01(inputs.structuralValidation) *
    clamp01(inputs.cohortOutlier);
  return { composite: clamp01(composite), breakdown: inputs };
}
