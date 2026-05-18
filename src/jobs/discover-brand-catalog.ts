import { z } from "zod";
import { eq } from "drizzle-orm";
import type { JobHandler } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import { brands, runs } from "../infrastructure/db/schema";
import { BrandItemService, discoverBrandCatalog, type DiscoverDeps } from "../domain/catalog";

const PayloadSchema = z.object({ brandId: z.number().int().positive() });

export interface MakeArgs {
  db: DB;
  buildDiscoverDeps: () => DiscoverDeps;
}

async function finishRun(db: DB, runId: number, summary: Record<string, unknown>): Promise<void> {
  await db
    .update(runs)
    .set({ finishedAt: new Date().toISOString(), ...summary })
    .where(eq(runs.id, runId));
}

export function makeDiscoverBrandCatalogHandler(args: MakeArgs): JobHandler {
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
      const repo = new BrandItemService(args.db);
      const result = await discoverBrandCatalog(args.buildDiscoverDeps(), {
        brandId,
        brandPrimaryUrl: brand.primaryUrl,
      });

      const seenUrls = new Set<string>();
      let created = 0;
      let updated = 0;
      for (const draft of result.drafts) {
        seenUrls.add(draft.sourceUrl);
        const r = await repo.upsertDraft(draft, run.id);
        if (r.created) created++;
        else updated++;
      }

      // Mark items not seen in this run as discontinued.
      const existing = await repo.listForBrand(brandId);
      let discontinued = 0;
      for (const item of existing) {
        if (!seenUrls.has(item.sourceUrl)) {
          await repo.markDiscontinued(item.id, run.id);
          discontinued++;
        }
      }

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
