import { cacheHeaders, computeEtag, notModified } from "../infrastructure/http";

const MAX_AGE_SECS = 300;

export function jsonWithCaching(body: string, request: Request): Response {
  const etag = computeEtag(body);
  if (notModified(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: cacheHeaders(MAX_AGE_SECS, etag) });
  }
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json", ...cacheHeaders(MAX_AGE_SECS, etag) },
  });
}
