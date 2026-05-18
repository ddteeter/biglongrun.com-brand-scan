import nodePath from "node:path";
import type { DB } from "../../infrastructure/db";
import { BrandService } from "../brands/service";
import { brandSlugFromName } from "../brands/slug";
import { AuthorAssessmentService } from "./service";
import { parseBlogReviewsDir } from "./blog-parser";

export interface BackfillOptions {
  db: DB;
  blogRepo: string;
  reviewsDir: string;
  dryRun: boolean;
}

export interface BackfillSummary {
  created: number;
  skipped: number;
}

/**
 * Run the blog-review backfill.
 *
 * For each parsed blog review:
 *  - Skips if sizeOptionsRating is null (no useful signal)
 *  - Looks up brand by slug derived from review.brand name
 *  - If brand missing: logs warning and skips
 *  - In dry-run mode: logs intent, does NOT insert
 *  - Otherwise: creates an assessment using sizeOptionsRating for both
 *    `size_options` and `overall_inclusivity` (the only signal available
 *    from a single-dimension blog review), and 5 (neutral midpoint on a
 *    0-10 scale) for the other three dimensions.
 */
export async function runBackfill(options: BackfillOptions): Promise<BackfillSummary> {
  const { db, blogRepo, reviewsDir, dryRun } = options;

  const fullReviewsPath = nodePath.join(blogRepo, reviewsDir);
  const reviews = await parseBlogReviewsDir(fullReviewsPath);

  const brandSvc = new BrandService(db);
  const assessmentSvc = new AuthorAssessmentService(db);

  let created = 0;
  let skipped = 0;

  for (const review of reviews) {
    // Skip reviews with no size options signal
    if (review.sizeOptionsRating === null) {
      skipped++;
      continue;
    }

    const slug = brandSlugFromName(review.brand);
    const brand = await brandSvc.findBySlug(slug);

    if (!brand) {
      console.warn(
        `[backfill] Warning: brand not found for slug "${slug}" (from "${review.brand}"), skipping`
      );
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(
        `[dry-run] Would create assessment for ${brand.slug} (${review.brand}) on ${review.date}`
      );
      skipped++;
      continue;
    }

    // Use sizeOptionsRating for size_options AND overall_inclusivity — these are the
    // only signals present in a single-dimension blog review. The other three dimensions
    // default to 5 (neutral midpoint on the 0–10 scale) since no data is available.
    await assessmentSvc.create({
      brandId: brand.id,
      authorSlug: review.author || "drew",
      assessmentDate: review.date,
      ratings: {
        size_options: review.sizeOptionsRating,
        tier_equity: 5,
        pricing_equity: 5,
        fit_label_honesty: 5,
        overall_inclusivity: review.sizeOptionsRating,
      },
      proseMarkdown: "",
      origin: "backfilled_from_blog_review",
      sourceReviewUrl: review.reviewUrl ?? undefined,
    });

    created++;
  }

  console.log(`[backfill] Done. Created ${String(created)}, skipped ${String(skipped)}.`);
  return { created, skipped };
}
