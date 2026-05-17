import { Layout, renderHtml } from "../layout";
import { Elysia } from "elysia";
import { and, eq, desc } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brandSizeChartVersions, brands, runArtifacts } from "../../infrastructure/db/schema";

export function queueRoute(args: Readonly<{ db: DB; artifactsPublicBaseUrl: string }>): Elysia {
  return new Elysia().get("/admin/queue", async ({ request }) => {
    const url = new URL(request.url);
    const filter = url.searchParams.get("filter") ?? "all";
    const versions = await args.db
      .select({
        v: brandSizeChartVersions,
        brand: brands,
      })
      .from(brandSizeChartVersions)
      .innerJoin(brands, eq(brandSizeChartVersions.brandId, brands.id))
      .where(eq(brandSizeChartVersions.status, "pending_review"))
      .orderBy(desc(brandSizeChartVersions.extractedAt));

    const filtered = versions.filter((row) => {
      if (filter === "low_confidence") return row.v.confidenceScore < 0.4;
      if (filter === "large_delta") return row.v.confidenceScore >= 0.85;
      return true;
    });

    const first = filtered[0];
    const total = filtered.length;

    const queueItemHtml = first
      ? await renderQueueItem(args.db, args.artifactsPublicBaseUrl, first)
      : "<p>Queue is empty.</p>";

    return renderHtml(
      <Layout title="Review queue" currentPath="/admin/queue">
        <hgroup>
          <h1>Review queue</h1>
          <p>{String(total)} pending</p>
        </hgroup>
        <nav>
          <ul>
            <li>
              <a
                href="/admin/queue?filter=all"
                aria-current={filter === "all" ? "page" : undefined}
              >
                All
              </a>
            </li>
            <li>
              <a
                href="/admin/queue?filter=low_confidence"
                aria-current={filter === "low_confidence" ? "page" : undefined}
              >
                Low confidence
              </a>
            </li>
            <li>
              <a
                href="/admin/queue?filter=large_delta"
                aria-current={filter === "large_delta" ? "page" : undefined}
              >
                Large delta
              </a>
            </li>
          </ul>
        </nav>
        {queueItemHtml}
      </Layout>
    );
  });
}

async function renderQueueItem(
  db: DB,
  artifactsBaseUrl: string,
  item: Readonly<{
    v: typeof brandSizeChartVersions.$inferSelect;
    brand: typeof brands.$inferSelect;
  }>
): Promise<string> {
  const sourceRunId = item.v.sourceRunId;
  const artifacts = sourceRunId
    ? await db
        .select()
        .from(runArtifacts)
        .where(and(eq(runArtifacts.runId, sourceRunId), eq(runArtifacts.kind, "screenshot")))
        .limit(1)
    : [];
  const artifact = artifacts[0];
  return (
    <div id="queue-item" class="grid">
      <article>
        <header>
          <h3>{item.brand.name}</h3>
          <p>
            {item.brand.slug} · confidence {item.v.confidenceScore.toFixed(2)}
          </p>
        </header>
        {artifact
          ? `<img src="${artifactsBaseUrl}/${artifact.filePath}" alt="page screenshot" style="max-width:100%;border:1px solid var(--pico-muted-border-color);" />`
          : "<p>(no screenshot)</p>"}
      </article>
      <article>
        <form method="post" action={`/admin/queue/${String(item.v.id)}/approve`}>
          <label for="size_chart_json">Extracted JSON (editable):</label>
          <textarea
            name="size_chart_json"
            id="size_chart_json"
            rows="20"
            style="font-family:monospace;font-size:0.85em;"
          >
            {JSON.stringify(item.v.sizeChartJson, null, 2)}
          </textarea>
          <fieldset role="group">
            <button type="submit" name="action" value="approve">
              Approve
            </button>
            <button type="submit" name="action" value="approve_with_edits" class="secondary">
              Approve with edits
            </button>
          </fieldset>
        </form>
        <form method="post" action={`/admin/queue/${String(item.v.id)}/reject`}>
          <input type="text" name="reason" placeholder="Reason for rejection (required)" required />
          <button type="submit" class="contrast">
            Reject
          </button>
        </form>
        <form method="post" action={`/admin/queue/${String(item.v.id)}/reprocess`}>
          <button type="submit" class="secondary outline">
            Reprocess (reuse stored Firecrawl output)
          </button>
        </form>
      </article>
    </div>
  );
}
