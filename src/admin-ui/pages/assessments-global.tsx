import { AuthorAssessmentService, renderMarkdown } from "../../domain/assessments";
import { BrandService } from "../../domain/brands";
import type { DB } from "../../infrastructure/db";

export async function AssessmentsGlobalPage(args: Readonly<{ db: DB }>): Promise<string> {
  const service = new AuthorAssessmentService(args.db);
  const brandService = new BrandService(args.db);
  const rows = await service.listAll();

  if (rows.length === 0) {
    return (
      <div>
        <h2>All Assessments</h2>
        <p>No assessments yet.</p>
      </div>
    );
  }

  // Resolve brand slugs (N+1 acceptable at single-user scale)
  const brandSlugs = new Map<number, string>();
  const brandNames = new Map<number, string>();
  for (const row of rows) {
    if (!brandSlugs.has(row.brandId)) {
      const brand = await brandService.findById(row.brandId);
      brandSlugs.set(row.brandId, brand?.slug ?? String(row.brandId));
      brandNames.set(row.brandId, brand?.name ?? String(row.brandId));
    }
  }

  return (
    <div>
      <h2>All Assessments ({String(rows.length)})</h2>
      <table role="grid">
        <thead>
          <tr>
            <th>Brand</th>
            <th>Date</th>
            <th>Author</th>
            <th>Overall</th>
            <th>Origin</th>
            <th>Prose</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const slug = brandSlugs.get(row.brandId) ?? String(row.brandId);
            const name = brandNames.get(row.brandId) ?? slug;
            const overall = (row.ratingsJson as { overall_inclusivity: number })
              .overall_inclusivity;
            return (
              <tr>
                <td>
                  <a href={`/admin/brands/${slug}?tab=assessments`}>{name}</a>
                </td>
                <td>{row.assessmentDate}</td>
                <td>{row.authorSlug}</td>
                <td>{String(overall)}</td>
                <td>{row.origin === "backfilled_from_blog_review" ? "blog backfill" : "native"}</td>
                <td safe>{renderMarkdown(row.proseMarkdown.slice(0, 200))}</td>
                <td>
                  <a href={`/admin/assessments/${String(row.id)}/edit`}>Edit</a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
