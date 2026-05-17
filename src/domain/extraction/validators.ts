import type { CanonicalSizeChart } from "./canonical";

const PLAUSIBLE = {
  chest_in: [20, 70],
  waist_in: [18, 70],
  hip_in: [20, 70],
} as const;

export interface ValidationResult {
  score: number; // 0..1
  issues: string[];
}

export function validateStructural(chart: CanonicalSizeChart): ValidationResult {
  const issues: string[] = [];

  // Required: at least one size label with measurements
  if (chart.size_labels.length === 0) {
    issues.push("no size labels present");
  }

  // Monotonicity check on chest_in midpoint across declared label order
  const midpoints = chart.size_labels
    .map((label) => chart.measurements[label])
    .filter((m): m is NonNullable<typeof m> => m !== undefined)
    .map((m) => (m.chest_in[0] + m.chest_in[1]) / 2);
  for (let i = 1; i < midpoints.length; i++) {
    const curr = midpoints[i];
    const prev = midpoints[i - 1];
    if (curr !== undefined && prev !== undefined && curr < prev) {
      issues.push("measurements are not monotonic across size labels");
      break;
    }
  }

  // Plausible ranges per field
  for (const [label, m] of Object.entries(chart.measurements)) {
    for (const key of ["chest_in", "waist_in", "hip_in"] as const) {
      const [lo, hi] = m[key];
      const [pLo, pHi] = PLAUSIBLE[key];
      if (lo < pLo || hi > pHi || lo > hi) {
        issues.push(
          `label ${label} ${key}=[${String(lo)},${String(hi)}] outside plausible range [${String(pLo)},${String(pHi)}]`
        );
      }
    }
    // Adult body: chest > waist typically
    if (m.chest_in[1] < m.waist_in[0]) {
      issues.push(`label ${label} chest < waist (columns may be transposed)`);
    }
  }

  const score = issues.length === 0 ? 1 : Math.max(0, 1 - issues.length * 0.2);
  return { score, issues };
}
