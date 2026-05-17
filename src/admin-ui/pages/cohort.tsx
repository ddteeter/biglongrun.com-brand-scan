import { Layout, renderHtml } from "../layout";
import { Elysia, type AnyElysia } from "elysia";
import { desc } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { cohortSummaries } from "../../infrastructure/db/schema";
import type { Queue } from "../../infrastructure/queue";

export function cohortRoute(args: Readonly<{ db: DB; queue: Queue }>): AnyElysia {
  return new Elysia()
    .get("/admin/cohort", async () => {
      const [latest] = await args.db
        .select()
        .from(cohortSummaries)
        .orderBy(desc(cohortSummaries.computedAt))
        .limit(1);
      return renderHtml(
        <Layout title="Cohort" currentPath="/admin/cohort">
          <h1>Cohort summary</h1>
          {latest ? (
            <article>
              <header>
                <p>
                  Computed {latest.computedAt} · {String(latest.brandCount)} brands · config{" "}
                  {latest.scoringConfigVersion}
                </p>
              </header>
              <pre>
                <code>{JSON.stringify(latest.summaryJson, null, 2)}</code>
              </pre>
            </article>
          ) : (
            "<p>No cohort summary yet.</p>"
          )}
          <form method="post" action="/admin/cohort/recompute">
            <button type="submit">Recompute now</button>
          </form>
        </Layout>
      );
    })
    .post("/admin/cohort/recompute", async ({ set }) => {
      await args.queue.enqueue({
        jobType: "recompute-cohort-summary",
        payload: {},
        dedupeKey: `recompute-cohort-summary:manual:${String(Date.now())}`,
      });
      set.status = 302;
      set.headers.location = "/admin/cohort";
      return "";
    });
}
