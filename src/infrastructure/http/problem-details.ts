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
  Unauthorized: "https://brand-scan/problem/unauthorized",
  NotFound: "https://brand-scan/problem/not-found",
  ValidationError: "https://brand-scan/problem/validation-error",
  RateLimited: "https://brand-scan/problem/rate-limited",
  Internal: "https://brand-scan/problem/internal",
} as const;
