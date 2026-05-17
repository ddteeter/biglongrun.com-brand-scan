import { eq } from "drizzle-orm";
import type { DB } from "../../../infrastructure/db";
import { brandScoreSnapshots } from "../../../infrastructure/db/schema";

export async function ScoreHistoryTab(
  args: Readonly<{ db: DB; brandId: number }>
): Promise<string> {
  const rows = await args.db
    .select()
    .from(brandScoreSnapshots)
    .where(eq(brandScoreSnapshots.brandId, args.brandId))
    .orderBy(brandScoreSnapshots.snapshotAt);
  return (
    <div>
      <h3>Snapshots</h3>
      <table role="grid">
        <thead>
          <tr>
            <th>At</th>
            <th>Public</th>
            <th>Composite</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const composite = (s.scoresJson as { composite?: number }).composite;
            return (
              <tr>
                <td>{s.snapshotAt}</td>
                <td>{s.isPublic ? "✓" : ""}</td>
                <td>{composite?.toFixed(2) ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
