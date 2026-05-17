import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../../../infrastructure/db";
import { brandSizeChartVersions } from "../../../infrastructure/db/schema";
import { BrandRepo } from "../../../domain/brands";

export async function SizeChartTab(args: Readonly<{ db: DB; brandId: number }>): Promise<string> {
  const repo = new BrandRepo(args.db);
  const brand = await repo.findById(args.brandId);
  if (!brand?.currentSizeChartVersionId) return <p>No accepted size chart yet.</p>;
  const [current] = await args.db
    .select()
    .from(brandSizeChartVersions)
    .where(
      and(
        eq(brandSizeChartVersions.id, brand.currentSizeChartVersionId),
        eq(brandSizeChartVersions.brandId, args.brandId)
      )
    )
    .limit(1);
  const history = await args.db
    .select()
    .from(brandSizeChartVersions)
    .where(eq(brandSizeChartVersions.brandId, args.brandId))
    .orderBy(desc(brandSizeChartVersions.extractedAt))
    .limit(20);
  return (
    <div>
      <h3>Current size chart</h3>
      <pre>
        <code>{JSON.stringify(current?.sizeChartJson, null, 2)}</code>
      </pre>
      <h3>Version history</h3>
      <table role="grid">
        <thead>
          <tr>
            <th>Extracted</th>
            <th>Status</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {history.map((v) => (
            <tr>
              <td>{v.extractedAt}</td>
              <td>{v.status}</td>
              <td>{v.confidenceScore.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
