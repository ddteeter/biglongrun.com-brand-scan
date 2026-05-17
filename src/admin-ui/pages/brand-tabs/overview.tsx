import { eq, desc } from "drizzle-orm";
import type { DB } from "../../../infrastructure/db";
import { brands, brandScoreHistory } from "../../../infrastructure/db/schema";

export async function OverviewTab(args: Readonly<{ db: DB; brandId: number }>): Promise<string> {
  const [brand] = await args.db.select().from(brands).where(eq(brands.id, args.brandId)).limit(1);
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
        <p>
          {brand?.divergenceFlag
            ? "Divergence flag set: computed scores diverge from author assessments."
            : ""}
        </p>
      </div>
    );
  }
  return (
    <div>
      <h3>Current scores</h3>
      <p>No scores computed yet.</p>
      <p>
        {brand?.divergenceFlag
          ? "Divergence flag set: computed scores diverge from author assessments."
          : ""}
      </p>
    </div>
  );
}
