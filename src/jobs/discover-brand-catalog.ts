import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { JobHandler } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import { brands, brandSources, runs } from "../infrastructure/db/schema";
import {
  BrandItemService,
  discoverBrandCatalog,
  type DiscoverDeps,
  type ItemFetchState,
} from "../domain/catalog";

const PayloadSchema = z.object({ brandId: z.number().int().positive() });

export interface MakeArgs {
  db: DB;
  buildDiscoverDeps: () => DiscoverDeps;
}

type BrandSourceRow = typeof brandSources.$inferSelect;

async function finishRun(db: DB, runId: number, summary: Record<string, unknown>): Promise<void> {
  await db
    .update(runs)
    .set({ finishedAt: new Date().toISOString(), ...summary })
    .where(eq(runs.id, runId));
}

/** Load the catalog-root BrandSource for a brand, if one exists. */
async function loadCatalogSource(db: DB, brandId: number): Promise<BrandSourceRow | null> {
  const [root] = await db
    .select()
    .from(brandSources)
    .where(and(eq(brandSources.brandId, brandId), eq(brandSources.sourceType, "catalog_root")))
    .limit(1);
  if (root) return root;

  const [shopify] = await db
    .select()
    .from(brandSources)
    .where(and(eq(brandSources.brandId, brandId), eq(brandSources.sourceType, "shopify_feed")))
    .limit(1);

  return shopify ?? null;
}

function buildFetchStateColumns(
  fetchState: ItemFetchState | null,
  nowIso: string
): Record<string, string | null> {
  return fetchState
    ? {
        lastEtag: fetchState.etag,
        lastModifiedHeader: fetchState.lastModified,
        lastFetchHash: fetchState.bodyHash,
        lastChangedAt: nowIso,
      }
    : {};
}

/** Upsert the catalog-root BrandSource after a discovery run. */
async function upsertCatalogSource(
  db: DB,
  brandId: number,
  url: string,
  sourceType: "shopify_feed" | "catalog_root",
  fetchState: ItemFetchState | null,
  nowIso: string
): Promise<void> {
  const fetchCols = buildFetchStateColumns(fetchState, nowIso);
  await db
    .insert(brandSources)
    .values({ brandId, url, sourceType, lastFetchedAt: nowIso, ...fetchCols })
    .onConflictDoUpdate({
      target: [brandSources.brandId, brandSources.url],
      set: { lastFetchedAt: nowIso, ...fetchCols },
    });
}

function catalogRootUrl(primaryUrl: string, sourceType: "shopify_feed" | "catalog_root"): string {
  const host = new URL(primaryUrl).host;
  return sourceType === "shopify_feed"
    ? `https://${host}/products.json?page=1&limit=250`
    : `https://${host}/sitemap.xml`;
}

function buildCatalogConditional(
  source: BrandSourceRow | null
): Record<string, string> | undefined {
  if (!source) return undefined;
  const cond: Record<string, string> = {};
  if (source.lastEtag) cond.etag = source.lastEtag;
  if (source.lastModifiedHeader) cond.lastModified = source.lastModifiedHeader;
  if (source.lastFetchHash) cond.bodyHash = source.lastFetchHash;
  return Object.keys(cond).length > 0 ? cond : undefined;
}

/** Upsert all discovered item drafts and return counts. */
async function processDrafts(
  repo: BrandItemService,
  runId: number,
  drafts: Awaited<ReturnType<typeof discoverBrandCatalog>>["drafts"]
): Promise<{ seenUrls: Set<string>; created: number; updated: number }> {
  const seenUrls = new Set<string>();
  let created = 0;
  let updated = 0;
  for (const draft of drafts) {
    seenUrls.add(draft.sourceUrl);
    const r = await repo.upsertDraft(draft, runId, draft.fetchState ?? undefined);
    if (r.created) created++;
    else updated++;
  }
  return { seenUrls, created, updated };
}

/** Mark items not seen in the current run as discontinued. */
async function markUnseen(
  repo: BrandItemService,
  brandId: number,
  runId: number,
  seenUrls: Set<string>
): Promise<number> {
  const existing = await repo.listForBrand(brandId);
  let discontinued = 0;
  for (const item of existing) {
    if (!seenUrls.has(item.sourceUrl)) {
      await repo.markDiscontinued(item.id, runId);
      discontinued++;
    }
  }
  return discontinued;
}

export function makeDiscoverBrandCatalogHandler(args: MakeArgs): JobHandler {
  // Transactional boundary note: the outer handler is intentionally NOT wrapped in a
  // single db.transaction. Each upsertDraft / markDiscontinued call is internally
  // atomic via BrandItemService. A partial failure mid-iteration should still leave
  // a runs row with status='failed' so it shows up in the admin queue and Pushover.
  // Long-running multi-item loops also shouldn't hold a SQLite writer lock open.
  // Same pattern as extract-brand-source.
  return async (rawPayload, ctx) => {
    const { brandId } = PayloadSchema.parse(rawPayload);
    const [brand] = await args.db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
    if (!brand) throw new Error(`brand not found: ${String(brandId)}`);

    const [run] = await args.db
      .insert(runs)
      .values({ jobId: ctx.jobId, status: "running" })
      .returning();
    if (!run) throw new Error("runs insert returned empty");

    try {
      const nowIso = new Date().toISOString();
      const repo = new BrandItemService(args.db);
      const catalogSource = await loadCatalogSource(args.db, brandId);

      const deps = args.buildDiscoverDeps();
      deps.loadItemFetchState = async (sourceUrl: string) => {
        const item = await repo.findByBrandAndUrl(brandId, sourceUrl);
        return item
          ? {
              lastEtag: item.lastEtag,
              lastModifiedHeader: item.lastModifiedHeader,
              lastFetchHash: item.lastFetchHash,
            }
          : null;
      };

      const catalogConditional = buildCatalogConditional(catalogSource);
      const result = await discoverBrandCatalog(deps, {
        brandId,
        brandPrimaryUrl: brand.primaryUrl,
        ...(catalogConditional ? { catalogConditional } : {}),
      });

      if (result.unchanged) {
        if (catalogSource) {
          await args.db
            .update(brandSources)
            .set({ lastFetchedAt: nowIso })
            .where(eq(brandSources.id, catalogSource.id));
        }
        await finishRun(args.db, run.id, {
          status: "succeeded",
          summaryJson: {
            source: result.source,
            unchanged: true,
            created: 0,
            updated: 0,
            discontinued: 0,
            total: 0,
          },
        });
        return;
      }

      if (result.source !== "none") {
        const sourceType: "shopify_feed" | "catalog_root" =
          result.source === "shopify" ? "shopify_feed" : "catalog_root";
        await upsertCatalogSource(
          args.db,
          brandId,
          catalogRootUrl(brand.primaryUrl, sourceType),
          sourceType,
          result.catalogFetchState,
          nowIso
        );
      }

      const { seenUrls, created, updated } = await processDrafts(repo, run.id, result.drafts);
      const discontinued = await markUnseen(repo, brandId, run.id, seenUrls);

      await finishRun(args.db, run.id, {
        status: "succeeded",
        summaryJson: {
          source: result.source,
          created,
          updated,
          discontinued,
          total: result.drafts.length,
        },
      });
    } catch (error) {
      await finishRun(args.db, run.id, {
        status: "failed",
        summaryJson: { error: (error as Error).message },
      });
      throw error;
    }
  };
}
