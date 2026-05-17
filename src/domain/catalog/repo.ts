import { and, eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brandItems, brandItemChanges } from "../../infrastructure/db/schema";
import { ItemDraftSchema, type ItemDraft, type PerSizeData } from "./types";

// exactOptionalPropertyTypes: Zod infers `price?: number | undefined` but the column type expects
// `price?: number`. At runtime these are equivalent — the cast is safe.
type DbPerSizeData = Record<string, { available: boolean; price?: number; colors?: string[] }>;
function toDbPerSizeData(data: PerSizeData): DbPerSizeData {
  return data as DbPerSizeData;
}

export class BrandItemRepo {
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
    sourceRunId: number | null
  ): Promise<{ id: number; created: boolean }> {
    const draft: ItemDraft = ItemDraftSchema.parse(raw);
    const existing = await this.findByBrandAndUrl(draft.brandId, draft.sourceUrl);
    const nowIso = new Date().toISOString();
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
        })
        .where(eq(brandItems.id, existing.id));
      return { id: existing.id, created: false };
    }
    const [row] = await this.db
      .insert(brandItems)
      .values({
        brandId: draft.brandId,
        externalId: draft.externalId ?? null,
        sourceUrl: draft.sourceUrl,
        name: draft.name,
        category: draft.category,
        basePriceUsd: draft.basePriceUsd ?? null,
        perSizeDataJson: toDbPerSizeData(draft.perSizeData),
      })
      .returning({ id: brandItems.id });
    if (!row) throw new Error("brand_items insert returned empty");
    await this.db.insert(brandItemChanges).values({
      itemId: row.id,
      changeType: "added",
      afterJson: { name: draft.name, category: draft.category },
      sourceRunId: sourceRunId ?? null,
    });
    return { id: row.id, created: true };
  }

  async markDiscontinued(itemId: number, sourceRunId: number | null): Promise<void> {
    const nowIso = new Date().toISOString();
    const [before] = await this.db
      .select()
      .from(brandItems)
      .where(eq(brandItems.id, itemId))
      .limit(1);
    if (!before) throw new Error(`brand_item not found: ${String(itemId)}`);
    if (before.isDiscontinued) return;
    await this.db
      .update(brandItems)
      .set({ isDiscontinued: true, discontinuedAt: nowIso })
      .where(eq(brandItems.id, itemId));
    await this.db.insert(brandItemChanges).values({
      itemId,
      changeType: "discontinued",
      beforeJson: { name: before.name, category: before.category },
      sourceRunId: sourceRunId ?? null,
    });
  }
}
