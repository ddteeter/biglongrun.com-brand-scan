export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [extra: string]: unknown;
}

export function problemDetailsResponse(p: ProblemDetails): Response {
  const res = Response.json(p, {
    status: p.status,
  });
  res.headers.set("content-type", "application/problem+json");
  return res;
}

export const ProblemTypes = {
  Unauthorized: "https://brand-scan.biglongrun.com/problem/unauthorized",
  NotFound: "https://brand-scan.biglongrun.com/problem/not-found",
  ValidationError: "https://brand-scan.biglongrun.com/problem/validation-error",
  RateLimited: "https://brand-scan.biglongrun.com/problem/rate-limited",
  Internal: "https://brand-scan.biglongrun.com/problem/internal",
} as const;
