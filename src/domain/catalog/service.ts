import { and, eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brandItems, brandItemChanges } from "../../infrastructure/db/schema";
import { ItemDraftSchema, type ItemDraft, type PerSizeData } from "./types";
import type { ItemFetchState } from "./discoverer";

// exactOptionalPropertyTypes: Zod infers `price?: number | undefined` but the column type expects
// `price?: number`. At runtime these are equivalent — the cast is safe.
type DbPerSizeData = Record<string, { available: boolean; price?: number; colors?: string[] }>;
function toDbPerSizeData(data: PerSizeData): DbPerSizeData {
  return data as DbPerSizeData;
}

type BrandItem = typeof brandItems.$inferSelect;

export class BrandItemService {
  constructor(private readonly db: DB) {}

  async listForBrand(brandId: number, opts: { includeDiscontinued?: boolean } = {}) {
    if (opts.includeDiscontinued) {
      return this.db.select().from(brandItems).where(eq(brandItems.brandId, brandId));
    }
    return this.db
      .select()
      .from(brandItems)
      .where(and(eq(brandItems.brandId, brandId), eq(brandItems.isDiscontinued, false)));
  }

  async findByBrandAndUrl(brandId: number, sourceUrl: string) {
    const [row] = await this.db
      .select()
      .from(brandItems)
      .where(and(eq(brandItems.brandId, brandId), eq(brandItems.sourceUrl, sourceUrl)))
      .limit(1);
    return row ?? null;
  }

  async upsertDraft(
    raw: unknown,
    sourceRunId: number | null,
    fetchState?: ItemFetchState
  ): Promise<{ id: number; created: boolean }> {
    const draft: ItemDraft = ItemDraftSchema.parse(raw);
    const existing = await this.findByBrandAndUrl(draft.brandId, draft.sourceUrl);
    const nowIso = new Date().toISOString();
    const fetchColumns = fetchState
      ? {
          lastEtag: fetchState.etag,
          lastModifiedHeader: fetchState.lastModified,
          lastFetchHash: fetchState.bodyHash,
          lastFetchedAt: nowIso,
        }
      : {};
    if (existing) {
      await this.db
        .update(brandItems)
        .set({
          name: draft.name,
          category: draft.category,
          basePriceUsd: draft.basePriceUsd ?? null,
          perSizeDataJson: toDbPerSizeData(draft.perSizeData),
          lastVerifiedAt: nowIso,
          isDiscontinued: false,
          discontinuedAt: null,
          ...fetchColumns,
        })
        .where(eq(brandItems.id, existing.id));
      return { id: existing.id, created: false };
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(brandItems)
        .values({
          brandId: draft.brandId,
          externalId: draft.externalId ?? null,
          sourceUrl: draft.sourceUrl,
          name: draft.name,
          category: draft.category,
          basePriceUsd: draft.basePriceUsd ?? null,
          perSizeDataJson: toDbPerSizeData(draft.perSizeData),
          ...fetchColumns,
        })
        .returning({ id: brandItems.id });
      if (!row) throw new Error("brand_items insert returned empty");
      await tx.insert(brandItemChanges).values({
        itemId: row.id,
        changeType: "added",
        afterJson: { name: draft.name, category: draft.category },
        sourceRunId: sourceRunId ?? null,
      });
      return { id: row.id, created: true };
    });
  }

  async markDiscontinued(itemId: number, sourceRunId: number | null): Promise<void> {
    const nowIso = new Date().toISOString();
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(brandItems).where(eq(brandItems.id, itemId)).limit(1);
      if (!before) throw new Error(`brand_item not found: ${String(itemId)}`);
      if (before.isDiscontinued) return;
      await tx
        .update(brandItems)
        .set({ isDiscontinued: true, discontinuedAt: nowIso })
        .where(eq(brandItems.id, itemId));
      await tx.insert(brandItemChanges).values({
        itemId,
        changeType: "discontinued",
        beforeJson: { name: before.name, category: before.category },
        sourceRunId: sourceRunId ?? null,
      });
    });
  }

  // Private helper: apply a tier update + change-log entry within an existing tx.
  private async applyTierClassification(
    tx: Parameters<Parameters<DB["transaction"]>[0]>[0],
    itemId: number,
    before: BrandItem,
    newTier: string,
    newInferredBy: string,
    newRationale: string
  ): Promise<void> {
    await tx
      .update(brandItems)
      .set({
        tierClassification: newTier as typeof brandItems.$inferInsert.tierClassification,
        tierInferredBy: newInferredBy,
        tierRationale: newRationale,
      })
      .where(eq(brandItems.id, itemId));
    await tx.insert(brandItemChanges).values({
      itemId,
      changeType: "tier_reclassified",
      beforeJson: {
        tier: before.tierClassification,
        inferredBy: before.tierInferredBy,
        rationale: before.tierRationale,
      },
      afterJson: {
        tier: newTier,
        inferredBy: newInferredBy,
        rationale: newRationale,
      },
    });
  }

  async setTierByHuman(input: {
    itemId: number;
    tier: "flagship" | "mid" | "basic" | "unclassified";
    authorSlug: string;
    rationale: string;
  }): Promise<"ok" | "not_found"> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(brandItems)
        .where(eq(brandItems.id, input.itemId))
        .limit(1);
      if (!before) return "not_found";
      const tierInferredBy = `human:${input.authorSlug}`;
      const rationale = input.rationale || "human override";
      await this.applyTierClassification(
        tx,
        input.itemId,
        before,
        input.tier,
        tierInferredBy,
        rationale
      );
      return "ok";
    });
  }

  async setTierFromAutomation(input: {
    itemId: number;
    tier: "flagship" | "mid" | "basic" | "unclassified";
    inferredBy: string;
    rationale: string;
  }): Promise<"ok" | "not_found"> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(brandItems)
        .where(eq(brandItems.id, input.itemId))
        .limit(1);
      if (!before) return "not_found";
      await this.applyTierClassification(
        tx,
        input.itemId,
        before,
        input.tier,
        input.inferredBy,
        input.rationale
      );
      return "ok";
    });
  }
}
