import { Elysia, type AnyElysia } from "elysia";
import type { DB } from "../infrastructure/db";
import { AuthorAssessmentService } from "../domain/assessments/service";
import { renderMarkdown } from "../domain/assessments/markdown";
import { jsonWithCaching, lookupBrand } from "./response-helpers";

export function assessmentsRoute(args: { db: DB }): AnyElysia {
  return new Elysia().get("/api/v1/brands/:slug/assessments", async ({ params, request }) => {
    const brandOrResponse = await lookupBrand(args.db, params.slug);
    if (brandOrResponse instanceof Response) return brandOrResponse;
    const brand = brandOrResponse;

    const svc = new AuthorAssessmentService(args.db);
    const rows = await svc.listForBrand(brand.id);

    const assessments = rows.map((row) => ({
      authorSlug: row.authorSlug,
      assessmentDate: row.assessmentDate,
      ratings: row.ratingsJson,
      proseMarkdown: row.proseMarkdown,
      proseHtml: renderMarkdown(row.proseMarkdown),
    }));

    const body = JSON.stringify({ slug: brand.slug, count: assessments.length, assessments });
    return jsonWithCaching(body, request);
  });
}
