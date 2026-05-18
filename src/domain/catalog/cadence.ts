const MIN_CHANGES_FOR_CADENCE = 3;
const HIGH_VARIANCE_CV = 0.3;
const SAFETY_BUFFER_DAYS = 7;

export interface CadenceInput {
  acceptedChangeDates: string[]; // ISO timestamps of accepted size-chart version transitions
}

export interface CadenceResult {
  intervals: number[]; // days between consecutive changes
  medianDays: number | null;
  coefficientOfVariation: number | null;
  predictedNextChangeAt: string | null;
  reason: string;
}

function median(values: number[]): number {
  const sorted = [...values].toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

export function computeBrandCadence(input: CadenceInput, now: Date = new Date()): CadenceResult {
  const dates = input.acceptedChangeDates
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t))
    .toSorted((a, b) => a - b);

  if (dates.length < MIN_CHANGES_FOR_CADENCE) {
    return {
      intervals: [],
      medianDays: null,
      coefficientOfVariation: null,
      predictedNextChangeAt: null,
      reason: "fewer than 3 observed changes",
    };
  }

  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const a = dates[i - 1];
    const b = dates[i];
    if (a === undefined || b === undefined) continue;
    intervals.push((b - a) / 86_400_000);
  }

  const med = median(intervals);
  const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  const variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean === 0 ? 0 : stdDev / mean;

  if (cv > HIGH_VARIANCE_CV) {
    return {
      intervals,
      medianDays: med,
      coefficientOfVariation: cv,
      predictedNextChangeAt: null,
      reason: "high variance — fallback to default cadence",
    };
  }

  const lastChange = dates.at(-1) ?? now.getTime();
  const predictedMs = lastChange + (med - SAFETY_BUFFER_DAYS) * 86_400_000;
  return {
    intervals,
    medianDays: med,
    coefficientOfVariation: cv,
    predictedNextChangeAt: new Date(predictedMs).toISOString(),
    reason: `median ${String(Math.round(med))}d, cv ${cv.toFixed(2)}, low variance`,
  };
}
