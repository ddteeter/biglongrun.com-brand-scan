import { asc, eq } from "drizzle-orm";
import type { DB } from "../../../infrastructure/db";
import { brandItems } from "../../../infrastructure/db/schema";

const TIER_OPTIONS = ["flagship", "mid", "basic", "unclassified"] as const;

export async function ItemsTab(args: Readonly<{ db: DB; brandId: number }>): Promise<string> {
  const rows = await args.db
    .select()
    .from(brandItems)
    .where(eq(brandItems.brandId, args.brandId))
    .orderBy(asc(brandItems.category), asc(brandItems.name));

  if (rows.length === 0) {
    return (
      <div>
        <h3>Items</h3>
        <p>No items discovered yet. Run discover-brand-catalog or wait for the scheduled sweep.</p>
      </div>
    );
  }

  return (
    <div>
      <h3>Items ({String(rows.length)})</h3>
      <table role="grid">
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Tier</th>
            <th>Price</th>
            <th>Sizes</th>
            <th>Status</th>
            <th>Override</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const perSize = item.perSizeDataJson as Record<
              string,
              { available: boolean; price?: number; colors?: string[] }
            >;
            const availableSizes = Object.entries(perSize)
              .filter(([, v]) => v.available)
              .map(([k]) => k)
              .join(", ");
            return (
              <tr>
                <td>
                  <a href={item.sourceUrl}>{item.name}</a>
                </td>
                <td>{item.category}</td>
                <td>
                  {item.tierClassification}
                  {item.tierInferredBy ? <small> ({item.tierInferredBy})</small> : ""}
                </td>
                <td>{item.basePriceUsd == null ? "—" : `$${item.basePriceUsd.toFixed(2)}`}</td>
                <td>{availableSizes || "—"}</td>
                <td>{item.isDiscontinued ? "discontinued" : "active"}</td>
                <td>
                  <form
                    method="post"
                    action={`/admin/items/${String(item.id)}/set-tier`}
                    style="display:flex;gap:0.25rem;align-items:center"
                  >
                    <select name="tier">
                      {TIER_OPTIONS.map((t) => (
                        <option
                          value={t}
                          selected={t === item.tierClassification ? true : undefined}
                        >
                          {t}
                        </option>
                      ))}
                    </select>
                    <input type="text" name="rationale" placeholder="rationale" />
                    <button type="submit">Set</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
