import { eq } from "drizzle-orm";
import {
  cacheHeaders,
  computeEtag,
  notModified,
  problemDetailsResponse,
  ProblemTypes,
} from "../infrastructure/http";
import type { DB } from "../infrastructure/db";
import { brands } from "../infrastructure/db/schema";

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

/** Look up a brand by slug; returns the brand row or a 404 problem-details Response. */
export async function lookupBrand(
  db: DB,
  slug: string
): Promise<typeof brands.$inferSelect | Response> {
  const [brand] = await db.select().from(brands).where(eq(brands.slug, slug)).limit(1);
  if (!brand) {
    return problemDetailsResponse({
      type: ProblemTypes.NotFound,
      title: "Not Found",
      status: 404,
      detail: `No brand with slug ${slug}`,
    });
  }
  return brand;
}
