import { AuthorAssessmentService } from "../../domain/assessments";
import type { DB } from "../../infrastructure/db";
import { BrandService } from "../../domain/brands";

const RATING_KEYS = [
  "size_options",
  "tier_equity",
  "pricing_equity",
  "fit_label_honesty",
  "overall_inclusivity",
] as const;

export async function AssessmentEditPage(
  args: Readonly<{
    db: DB;
    assessmentId: number;
  }>
): Promise<string> {
  const service = new AuthorAssessmentService(args.db);
  const assessment = await service.findById(args.assessmentId);

  if (!assessment) {
    return (
      <div>
        <h2>Assessment not found</h2>
        <p>
          <a href="/admin/assessments">Back to all assessments</a>
        </p>
      </div>
    );
  }

  const brandService = new BrandService(args.db);
  const brand = await brandService.findById(assessment.brandId);
  const brandSlug = brand?.slug ?? "";
  const ratings = assessment.ratingsJson as unknown as Record<string, number>;

  return (
    <div>
      <hgroup>
        <h2>Edit Assessment</h2>
        {brand ? (
          <p>
            Brand: <a href={`/admin/brands/${brandSlug}?tab=assessments`}>{brand.name}</a>
          </p>
        ) : (
          <p>Brand ID: {String(assessment.brandId)}</p>
        )}
      </hgroup>

      <form method="post" action={`/admin/assessments/${String(assessment.id)}/update`}>
        {RATING_KEYS.map((key) => (
          <label>
            {key.replaceAll("_", " ")} (0–10)
            <input
              type="number"
              name={`rating_${key}`}
              min="0"
              max="10"
              step="0.5"
              required
              value={String(ratings[key] ?? 5)}
            />
          </label>
        ))}
        <label>
          Prose (markdown)
          <textarea
            name="proseMarkdown"
            rows="6"
            hx-post={`/admin/brands/${brandSlug}/assessments/preview`}
            hx-trigger="input changed delay:300ms"
            hx-target="#assessment-prose-preview"
            hx-swap="innerHTML"
          >
            {assessment.proseMarkdown}
          </textarea>
        </label>
        <article id="assessment-prose-preview">
          <small>Preview appears here as you type.</small>
        </article>
        <button type="submit">Save changes</button>
      </form>

      <p>
        <a href={`/admin/brands/${brandSlug}?tab=assessments`}>
          {`← Back to ${brand?.name ?? "brand"} assessments`}
        </a>
      </p>
    </div>
  );
}
