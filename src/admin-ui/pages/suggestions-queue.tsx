import { Elysia, type AnyElysia } from "elysia";
import type { DB } from "../../infrastructure/db";
import { BrandSuggestionService } from "../../domain/suggestions";
import { Layout, renderHtml } from "../layout";

function truncate(text: string | null, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

async function SuggestionsQueuePage(args: Readonly<{ db: DB }>): Promise<string> {
  const service = new BrandSuggestionService(args.db);
  const pending = await service.listPending();

  if (pending.length === 0) {
    return (
      <div>
        <h2>Suggestions queue</h2>
        <p>No pending suggestions. The Reddit sweep runs weekly Mondays at 07:00 UTC.</p>
      </div>
    );
  }

  return (
    <div>
      <h2>Suggestions queue ({String(pending.length)})</h2>
      <div style="overflow-x: auto;">
        <table role="grid">
          <thead>
            <tr>
              <th></th>
              <th>Brand</th>
              <th>Subreddit</th>
              <th>Post</th>
              <th>Context</th>
              <th>Accept</th>
              <th>Reject</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((row) => (
              <tr>
                <td>{row.plusSizePriority ? "⭐" : ""}</td>
                <td>{row.suggestedBrandName}</td>
                <td>
                  {row.sourceSubreddit ? (
                    <a
                      href={`https://www.reddit.com/r/${row.sourceSubreddit}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      r/{row.sourceSubreddit}
                    </a>
                  ) : (
                    ""
                  )}
                </td>
                <td>
                  {row.sourcePostUrl ? (
                    <a href={row.sourcePostUrl} target="_blank" rel="noopener noreferrer">
                      {row.sourcePostTitle ?? "View post"}
                    </a>
                  ) : (
                    ""
                  )}
                </td>
                <td>{truncate(row.sourceContext, 200)}</td>
                <td>
                  <form method="post" action={`/admin/suggestions/${String(row.id)}/accept`}>
                    <input
                      type="url"
                      name="primaryUrl"
                      value={row.suggestedUrl ?? ""}
                      placeholder="https://brand.com"
                      style="min-width: 160px;"
                    />
                    <button type="submit" class="outline">
                      Accept
                    </button>
                  </form>
                </td>
                <td>
                  <form method="post" action={`/admin/suggestions/${String(row.id)}/reject`}>
                    <input
                      type="text"
                      name="reason"
                      placeholder="Reason…"
                      style="min-width: 120px;"
                    />
                    <button type="submit" class="secondary outline">
                      Reject
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function suggestionsQueueRoute(args: Readonly<{ db: DB }>): AnyElysia {
  return new Elysia().get("/admin/suggestions", async () => {
    const content = await SuggestionsQueuePage({ db: args.db });
    return renderHtml(
      <Layout title="Suggestions" currentPath="/admin/suggestions">
        {content}
      </Layout>
    );
  });
}
