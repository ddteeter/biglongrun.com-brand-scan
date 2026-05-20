import { eq, desc } from "drizzle-orm";
import type { DB } from "../../../infrastructure/db";
import { brandScoreHistory } from "../../../infrastructure/db/schema";
import { BrandService } from "../../../domain/brands";

function DivergenceBanner(args: Readonly<{ divergenceFlag: boolean | null | undefined }>) {
  return args.divergenceFlag ? (
    <article
      aria-label="Divergence warning"
      style="background: var(--pico-del-color, #e74c3c); color: #fff; padding: 0.75rem 1rem; border-radius: 4px; margin-bottom: 1rem;"
    >
      <strong>{"⚠ Divergence detected"}</strong>
      {
        ": The computed composite score differs from the mean author assessment by more than the threshold. Review the author assessments tab for details, or re-run scoring after updating assessments."
      }
    </article>
  ) : (
    <></>
  );
}

export async function OverviewTab(args: Readonly<{ db: DB; brandId: number }>): Promise<string> {
  const repo = new BrandService(args.db);
  const brand = await repo.findById(args.brandId);
  const [latest] = await args.db
    .select()
    .from(brandScoreHistory)
    .where(eq(brandScoreHistory.brandId, args.brandId))
    .orderBy(desc(brandScoreHistory.computedAt))
    .limit(1);
  const scores = latest?.scoresJson;
  if (scores) {
    return (
      <div>
        {DivergenceBanner({ divergenceFlag: brand?.divergenceFlag })}
        <h3>Current scores</h3>
        <table>
          <tbody>
            {Object.entries(scores).map(([k, v]) => (
              <tr>
                <th>{k}</th>
                <td>{v === null ? "—" : v.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div>
      {DivergenceBanner({ divergenceFlag: brand?.divergenceFlag })}
      <h3>Current scores</h3>
      <p>No scores computed yet.</p>
    </div>
  );
}
