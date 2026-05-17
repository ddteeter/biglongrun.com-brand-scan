import { eq } from "drizzle-orm";
import type { DB } from "../../../infrastructure/db";
import { brandSources } from "../../../infrastructure/db/schema";

export async function SourcesTab(args: Readonly<{ db: DB; brandId: number }>): Promise<string> {
  const rows = await args.db
    .select()
    .from(brandSources)
    .where(eq(brandSources.brandId, args.brandId));
  return (
    <div>
      <h3>Sources</h3>
      <form method="post" action="/admin/brand-sources/create">
        <input type="hidden" name="brandId" value={String(args.brandId)} />
        <fieldset role="group">
          <input type="url" name="url" placeholder="https://brand.com/size-chart" required />
          <select name="sourceType">
            <option value="size_chart">Size chart</option>
            <option value="catalog_root">Catalog root</option>
            <option value="shopify_feed">Shopify feed</option>
          </select>
          <button type="submit">Add source</button>
        </fieldset>
      </form>
      <table role="grid">
        <thead>
          <tr>
            <th>URL</th>
            <th>Type</th>
            <th>Last fetched</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr>
              <td>
                <code>{s.url}</code>
              </td>
              <td>{s.sourceType}</td>
              <td>{s.lastFetchedAt ?? "—"}</td>
              <td>
                <form
                  method="post"
                  action={`/admin/brand-sources/${String(s.id)}/delete`}
                  style="display:inline"
                >
                  <button type="submit" class="secondary outline">
                    Delete
                  </button>
                </form>
                <form
                  method="post"
                  action={`/admin/brand-sources/${String(s.id)}/extract-now`}
                  style="display:inline"
                >
                  <button type="submit">Extract now</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
