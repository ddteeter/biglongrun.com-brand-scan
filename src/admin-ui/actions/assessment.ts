import { Elysia, type AnyElysia } from "elysia";
import { AuthorAssessmentService, renderMarkdown } from "../../domain/assessments";
import type { DB } from "../../infrastructure/db";
import { BrandService } from "../../domain/brands";

const RATING_KEYS = [
  "size_options",
  "tier_equity",
  "pricing_equity",
  "fit_label_honesty",
  "overall_inclusivity",
] as const;

/** Safely extract a string value from a form field (handles File entries). */
function formString(form: FormData, key: string, fallback = ""): string {
  const raw = form.get(key);
  if (raw === null) return fallback;
  if (raw instanceof File) return fallback;
  return raw;
}

function parseRatings(form: FormData): {
  size_options: number;
  tier_equity: number;
  pricing_equity: number;
  fit_label_honesty: number;
  overall_inclusivity: number;
} {
  return {
    size_options: Number(formString(form, "rating_size_options", "5")),
    tier_equity: Number(formString(form, "rating_tier_equity", "5")),
    pricing_equity: Number(formString(form, "rating_pricing_equity", "5")),
    fit_label_honesty: Number(formString(form, "rating_fit_label_honesty", "5")),
    overall_inclusivity: Number(formString(form, "rating_overall_inclusivity", "5")),
  };
}

export function assessmentActions(args: Readonly<{ db: DB; authorSlug: string }>): AnyElysia {
  const assessments = new AuthorAssessmentService(args.db);
  const brandService = new BrandService(args.db);

  return new Elysia()
    .post("/admin/brands/:slug/assessments/create", async ({ params, request, set }) => {
      const brand = await brandService.findBySlug(params.slug);
      if (!brand) {
        set.status = 404;
        return "";
      }
      const form = await request.formData();
      const proseMarkdown = formString(form, "proseMarkdown");
      const ratings = parseRatings(form);
      try {
        await assessments.create({
          brandId: brand.id,
          authorSlug: args.authorSlug,
          ratings,
          proseMarkdown,
        });
      } catch (error) {
        set.status = 400;
        return `Invalid: ${(error as Error).message}`;
      }
      set.status = 302;
      set.headers.location = `/admin/brands/${params.slug}?tab=assessments`;
      return "";
    })
    .post("/admin/brands/:slug/assessments/preview", async ({ request }) => {
      const form = await request.formData();
      const md = formString(form, "proseMarkdown");
      return new Response(renderMarkdown(md), { headers: { "content-type": "text/html" } });
    })
    .post("/admin/assessments/:id/update", async ({ params, request, set }) => {
      const id = Number(params.id);
      const form = await request.formData();
      const rawProse = form.get("proseMarkdown");
      const proseMarkdown = rawProse === null || rawProse instanceof File ? undefined : rawProse;
      const anyRating = RATING_KEYS.some((k) => form.get(`rating_${k}`) !== null);
      const ratings = anyRating ? parseRatings(form) : undefined;
      try {
        const updateInput: {
          id: number;
          proseMarkdown?: string;
          ratings?: ReturnType<typeof parseRatings>;
        } = { id };
        if (proseMarkdown !== undefined) updateInput.proseMarkdown = proseMarkdown;
        if (ratings !== undefined) updateInput.ratings = ratings;
        await assessments.update(updateInput);
      } catch (error) {
        set.status = 400;
        return `Invalid: ${(error as Error).message}`;
      }
      set.status = 302;
      set.headers.location = request.headers.get("referer") ?? "/admin/assessments";
      return "";
    });
}
