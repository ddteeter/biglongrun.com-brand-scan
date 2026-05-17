import { Elysia } from "elysia";
import { count, desc, isNotNull, eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brands, brandSizeChartVersions, runs } from "../../infrastructure/db/schema";
import type { CircuitBreaker } from "../../domain/usage";
import { Layout, renderHtml } from "../layout";
import { Card } from "../components/card";

export interface DashboardArgs {
  db: DB;
  circuitBreaker: CircuitBreaker;
}

export function dashboardRoute(args: DashboardArgs): Elysia {
  return new Elysia().get("/admin", async () => {
    const [brandCountRow] = await args.db.select({ value: count() }).from(brands);
    const brandCount = brandCountRow?.value ?? 0;
    const [brandsWithChartRow] = await args.db
      .select({ value: count() })
      .from(brands)
      .where(isNotNull(brands.currentSizeChartVersionId));
    const brandsWithChart = brandsWithChartRow?.value ?? 0;
    const [pendingReviewRow] = await args.db
      .select({ value: count() })
      .from(brandSizeChartVersions)
      .where(eq(brandSizeChartVersions.status, "pending_review"));
    const pendingReview = pendingReviewRow?.value ?? 0;
    const recentRuns = await args.db.select().from(runs).orderBy(desc(runs.startedAt)).limit(10);
    const firecrawl = await args.circuitBreaker.check("firecrawl");
    const anthropic = await args.circuitBreaker.check("anthropic");

    return renderHtml(
      <Layout title="Dashboard" currentPath="/admin">
        <h1>Dashboard</h1>
        <div class="grid">
          <Card title="Brands tracked">{`${String(brandCount)} (with current chart: ${String(brandsWithChart)})`}</Card>
          <Card title="Pending review">
            <a href="/admin/queue">{String(pendingReview)}</a>
          </Card>
          <Card title="Firecrawl usage (month)">
            {`${String(firecrawl.used)} / ${String(firecrawl.budget)} pages — ${firecrawl.status}`}
          </Card>
          <Card title="Anthropic spend (month)">
            {`$${firecrawl.used.toFixed(2)} / $${String(anthropic.budget)} — ${anthropic.status}`}
          </Card>
        </div>
        <h2>Recent runs</h2>
        <table role="grid">
          <thead>
            <tr>
              <th>Run ID</th>
              <th>Status</th>
              <th>Started</th>
              <th>Finished</th>
            </tr>
          </thead>
          <tbody>
            {recentRuns.map((r) => (
              <tr>
                <td>{String(r.id)}</td>
                <td>{r.status}</td>
                <td>{r.startedAt}</td>
                <td>{r.finishedAt ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Layout>
    );
  });
}
