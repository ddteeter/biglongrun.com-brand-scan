import { and, count, desc, eq, sql } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brands, brandSuggestions } from "../../infrastructure/db/schema";
import { brandSlugFromName, resolveSlugCollision } from "../brands/slug";
import {
  AcceptSuggestionInputSchema,
  NewSuggestionInputSchema,
  RejectSuggestionInputSchema,
} from "./types";

// Transaction type derived from the DB type — same pattern as VersionService.
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

type SuggestionRow = typeof brandSuggestions.$inferSelect;
type SuggestionStatus = "pending" | "accepted" | "rejected";

export interface AcceptResult {
  brandId: number;
  brandSlug: string;
}

export class BrandSuggestionService {
  constructor(private readonly db: DB) {}

  async listPending(): Promise<SuggestionRow[]> {
    return this.db
      .select()
      .from(brandSuggestions)
      .where(eq(brandSuggestions.status, "pending"))
      .orderBy(desc(brandSuggestions.plusSizePriority), desc(brandSuggestions.suggestedAt));
  }

  async listByStatus(status: SuggestionStatus): Promise<SuggestionRow[]> {
    return this.db
      .select()
      .from(brandSuggestions)
      .where(eq(brandSuggestions.status, status))
      .orderBy(desc(brandSuggestions.suggestedAt));
  }

  async findById(id: number): Promise<SuggestionRow | null> {
    const [row] = await this.db
      .select()
      .from(brandSuggestions)
      .where(eq(brandSuggestions.id, id))
      .limit(1);
    return row ?? null;
  }

  async countPendingForSlug(slug: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(brandSuggestions)
      .where(and(eq(brandSuggestions.suggestedSlug, slug), eq(brandSuggestions.status, "pending")));
    return row?.n ?? 0;
  }

  /**
   * Zod-validates then inserts a new suggestion. Idempotent: if a pending
   * suggestion already exists for the same slug, returns the existing row's id
   * without inserting a duplicate.
   */
  async create(raw: unknown): Promise<number> {
    const input = NewSuggestionInputSchema.parse(raw);

    // Pre-check for existing pending suggestion (idempotent dedup).
    const [existing] = await this.db
      .select({ id: brandSuggestions.id })
      .from(brandSuggestions)
      .where(
        and(
          eq(brandSuggestions.suggestedSlug, input.suggestedSlug),
          eq(brandSuggestions.status, "pending")
        )
      )
      .limit(1);
    if (existing) return existing.id;

    const [row] = await this.db
      .insert(brandSuggestions)
      .values({
        suggestedBrandName: input.suggestedBrandName,
        suggestedSlug: input.suggestedSlug,
        suggestedUrl: input.suggestedUrl ?? null,
        source: "reddit",
        sourceSubreddit: input.sourceSubreddit,
        sourcePostUrl: input.sourcePostUrl,
        sourcePostTitle: input.sourcePostTitle,
        sourceContext: input.sourceContext,
        plusSizePriority: input.plusSizePriority,
      })
      .returning({ id: brandSuggestions.id });
    if (!row) throw new Error("brand_suggestions insert returned empty");
    return row.id;
  }

  /**
   * Accepts a pending suggestion. Wrapped in a transaction:
   * 1. SELECT suggestion; throw if not found or not pending.
   * 2. INSERT a new brand (with slug generated from suggestedBrandName).
   * 3. UPDATE the suggestion to status='accepted' with resolved_at + resolved_brand_id.
   *
   * Returns { brandId, brandSlug }. Rolls back fully on any failure.
   */
  async accept(raw: unknown): Promise<AcceptResult> {
    const input = AcceptSuggestionInputSchema.parse(raw);

    return this.db.transaction(async (tx) => {
      const suggestion = await this._findPendingOrThrow(tx, input.id);

      // Create the brand inside the transaction.
      const { id: brandId, slug: brandSlug } = await this._createBrandTx(
        tx,
        suggestion.suggestedBrandName,
        input.primaryUrl
      );

      // Update the suggestion.
      await tx
        .update(brandSuggestions)
        .set({
          status: "accepted",
          resolvedAt: new Date().toISOString(),
          resolvedBrandId: brandId,
        })
        .where(eq(brandSuggestions.id, input.id));

      return { brandId, brandSlug };
    });
  }

  /**
   * Rejects a pending suggestion. Validates reason is non-empty via Zod.
   */
  async reject(raw: unknown): Promise<void> {
    const input = RejectSuggestionInputSchema.parse(raw);
    await this.db
      .update(brandSuggestions)
      .set({
        status: "rejected",
        rejectionReason: input.reason,
        resolvedAt: new Date().toISOString(),
      })
      .where(eq(brandSuggestions.id, input.id));
  }

  /** SELECT pending suggestion or throw. Must be called inside a transaction. */
  private async _findPendingOrThrow(tx: Tx, id: number): Promise<SuggestionRow> {
    const [row] = await tx
      .select()
      .from(brandSuggestions)
      .where(eq(brandSuggestions.id, id))
      .limit(1);
    if (!row) throw new Error(`Suggestion ${String(id)} not found`);
    if (row.status !== "pending") {
      throw new Error(`Suggestion ${String(id)} is not pending (status: ${row.status})`);
    }
    return row;
  }

  /**
   * Creates a brand inside an existing transaction. Replicates the slug-generation
   * invariant from BrandService (query existing slugs, resolve collision).
   * This avoids widening BrandService's constructor type while keeping the write atomic.
   */
  private async _createBrandTx(
    tx: Tx,
    name: string,
    primaryUrl: string
  ): Promise<{ id: number; slug: string }> {
    const baseSlug = brandSlugFromName(name);
    const existingRows = await tx.select({ slug: brands.slug }).from(brands);
    const existing = new Set(existingRows.map((r) => r.slug));
    const slug = resolveSlugCollision(baseSlug, existing);
    const [row] = await tx
      .insert(brands)
      .values({
        slug,
        name,
        primaryUrl,
        categoryTag: "running",
        audienceTags: sql`'[]'`,
      })
      .returning({ id: brands.id, slug: brands.slug });
    if (!row) throw new Error("brands insert returned empty");
    return row;
  }
}
