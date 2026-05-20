import { AuthorAssessmentService, renderMarkdown } from "../../../domain/assessments";
import type { DB } from "../../../infrastructure/db";

const RATING_KEYS = [
  "size_options",
  "tier_equity",
  "pricing_equity",
  "fit_label_honesty",
  "overall_inclusivity",
] as const;

export async function AssessmentsTab(
  args: Readonly<{
    db: DB;
    brandId: number;
    brandSlug: string;
    authorSlug: string;
  }>
): Promise<string> {
  const service = new AuthorAssessmentService(args.db);
  const rows = await service.listForBrand(args.brandId);

  return (
    <div>
      <h3>Assessments</h3>
      <details>
        <summary role="button">Add new assessment</summary>
        <form method="post" action={`/admin/brands/${args.brandSlug}/assessments/create`}>
          <input type="hidden" name="authorSlug" value={args.authorSlug} />
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
                value="5"
              />
            </label>
          ))}
          <label>
            Prose (markdown)
            <textarea
              name="proseMarkdown"
              rows="6"
              placeholder="Editorial commentary, optional…"
              hx-post={`/admin/brands/${args.brandSlug}/assessments/preview`}
              hx-trigger="input changed delay:300ms"
              hx-target="#assessment-prose-preview"
              hx-swap="innerHTML"
            />
          </label>
          <article id="assessment-prose-preview">
            <small>Preview appears here as you type.</small>
          </article>
          <button type="submit">Save assessment</button>
        </form>
      </details>

      {rows.length === 0 ? (
        <p>No assessments yet.</p>
      ) : (
        <table role="grid">
          <thead>
            <tr>
              <th>Date</th>
              <th>Author</th>
              <th>Composite (overall)</th>
              <th>Prose</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr>
                <td>{row.assessmentDate}</td>
                <td>{row.authorSlug}</td>
                <td>
                  {String((row.ratingsJson as { overall_inclusivity: number }).overall_inclusivity)}
                </td>
                <td safe>{renderMarkdown(row.proseMarkdown.slice(0, 200))}</td>
                <td>
                  <a href={`/admin/assessments/${String(row.id)}/edit`}>Edit</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
