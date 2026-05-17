import { Layout, renderHtml } from "../layout";
import { Elysia } from "elysia";
import { sql } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { apiUsageLog } from "../../infrastructure/db/schema";

export function usageRoute(args: Readonly<{ db: DB }>): Elysia {
  return new Elysia().get("/admin/usage", async () => {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthStartIso = monthStart.toISOString();
    const rows = await args.db
      .select({
        provider: apiUsageLog.provider,
        units: sql<number>`sum(${apiUsageLog.unitsUsed})`,
        cost: sql<number>`sum(${apiUsageLog.estimatedCostUsd})`,
      })
      .from(apiUsageLog)
      .where(sql`${apiUsageLog.occurredAt} >= ${monthStartIso}`)
      .groupBy(apiUsageLog.provider);
    return renderHtml(
      <Layout title="Usage" currentPath="/admin/usage">
        <h1>API usage (this month)</h1>
        <table role="grid">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Units</th>
              <th>Cost (USD)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr>
                <td>{r.provider}</td>
                <td>{String(r.units)}</td>
                <td>${r.cost.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Layout>
    );
  });
}
