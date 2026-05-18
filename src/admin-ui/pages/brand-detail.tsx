import { Elysia, type AnyElysia } from "elysia";
import { eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brands } from "../../infrastructure/db/schema";
import { Layout, renderHtml } from "../layout";
import { OverviewTab } from "./brand-tabs/overview";
import { SourcesTab } from "./brand-tabs/sources";
import { SizeChartTab } from "./brand-tabs/size-chart";
import { ScoreHistoryTab } from "./brand-tabs/score-history";
import { RunsTab } from "./brand-tabs/runs";
import { ItemsTab } from "./brand-tabs/items";
import { AssessmentsTab } from "./brand-tabs/assessments";

const TABS = [
  "overview",
  "sources",
  "size-chart",
  "score-history",
  "runs",
  "items",
  "assessments",
] as const;
type Tab = (typeof TABS)[number];

export function brandDetailRoute(args: { db: DB; authorSlug: string }): AnyElysia {
  return new Elysia().get("/admin/brands/:slug", async ({ params, request }) => {
    const url = new URL(request.url);
    const tabParam = url.searchParams.get("tab") ?? "overview";
    const tab = (TABS.includes(tabParam as Tab) ? tabParam : "overview") as Tab;
    const [brand] = await args.db
      .select()
      .from(brands)
      .where(eq(brands.slug, params.slug))
      .limit(1);
    if (!brand) return new Response("Not found", { status: 404 });

    const tabContent = await renderTab(args.db, brand, tab, args.authorSlug);
    return renderHtml(
      <Layout title={brand.name} currentPath="/admin/brands">
        <hgroup>
          <h1>{brand.name}</h1>
          <p>
            <a href={brand.primaryUrl}>{brand.primaryUrl}</a> · {brand.categoryTag}
          </p>
        </hgroup>
        <nav>
          <ul>
            {TABS.map((t) => (
              <li>
                <a
                  href={`/admin/brands/${params.slug}?tab=${t}`}
                  aria-current={tab === t ? "page" : undefined}
                >
                  {t}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <section>{tabContent}</section>
      </Layout>
    );
  });
}

async function renderTab(
  db: DB,
  brand: { id: number; slug: string },
  tab: Tab,
  authorSlug: string
): Promise<string> {
  switch (tab) {
    case "overview": {
      return OverviewTab({ db, brandId: brand.id });
    }
    case "sources": {
      return SourcesTab({ db, brandId: brand.id });
    }
    case "size-chart": {
      return SizeChartTab({ db, brandId: brand.id });
    }
    case "score-history": {
      return ScoreHistoryTab({ db, brandId: brand.id });
    }
    case "runs": {
      return RunsTab({ db, brandId: brand.id });
    }
    case "items": {
      return ItemsTab({ db, brandId: brand.id });
    }
    case "assessments": {
      return AssessmentsTab({ db, brandId: brand.id, brandSlug: brand.slug, authorSlug });
    }
  }
}
