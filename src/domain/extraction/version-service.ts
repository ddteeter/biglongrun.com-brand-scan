import { and, eq, ne } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brandSizeChartVersions, brands } from "../../infrastructure/db/schema";
import type { CanonicalSizeChart } from "./canonical";
import type { ConfidenceResult } from "./confidence";

// Transaction type derived from the DB type to avoid repeating the ugly generic.
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export interface RecordExtractionInput {
  brandId: number;
  brandSourceId: number;
  runId: number;
  chart: CanonicalSizeChart;
  confidence: ConfidenceResult;
  deltaFromPrior: { fieldsChanged: number } | null;
  status: "accepted" | "pending_review";
  /** Required when status === "accepted". Default: "auto". */
  acceptedBy?: string;
}

export interface ApproveInput {
  versionId: number;
  /** e.g. "human:drew" */
  acceptedBy: string;
  sizeChartOverride?: CanonicalSizeChart | Record<string, unknown>;
}

export interface RejectInput {
  versionId: number;
  reason: string;
}

export type VersionRow = typeof brandSizeChartVersions.$inferSelect;

export class VersionService {
  constructor(private readonly db: DB) {}

  /** Used by the extraction pipeline after a successful extraction. */
  async recordExtraction(input: RecordExtractionInput): Promise<VersionRow> {
    return this.db.transaction(async (tx) => {
      const nowIso = new Date().toISOString();
      const [inserted] = await tx
        .insert(brandSizeChartVersions)
        .values({
          brandId: input.brandId,
          brandSourceId: input.brandSourceId,
          sourceRunId: input.runId,
          sizeChartJson: input.chart,
          confidenceScore: input.confidence.composite,
          confidenceBreakdownJson: input.confidence.breakdown,
          status: input.status,
          acceptedAt: input.status === "accepted" ? nowIso : null,
          acceptedBy: input.status === "accepted" ? (input.acceptedBy ?? "auto") : null,
          deltaFromPriorJson: input.deltaFromPrior,
        })
        .returning();
      if (!inserted) throw new Error("brand_size_chart_versions insert returned empty");
      if (input.status === "accepted") {
        await this._promoteAcceptedTx(tx, input.brandId, inserted.id);
      }
      return inserted;
    });
  }

  /** Used by the admin queue approve flow. */
  async approve(input: ApproveInput): Promise<VersionRow | null> {
    return this.db.transaction(async (tx) => {
      const [version] = await tx
        .select()
        .from(brandSizeChartVersions)
        .where(eq(brandSizeChartVersions.id, input.versionId))
        .limit(1);
      if (!version) return null;
      const nowIso = new Date().toISOString();
      await tx
        .update(brandSizeChartVersions)
        .set({
          status: "accepted",
          sizeChartJson: input.sizeChartOverride ?? version.sizeChartJson,
          acceptedAt: nowIso,
          acceptedBy: input.acceptedBy,
        })
        .where(eq(brandSizeChartVersions.id, input.versionId));
      await this._promoteAcceptedTx(tx, version.brandId, input.versionId);
      const [refreshed] = await tx
        .select()
        .from(brandSizeChartVersions)
        .where(eq(brandSizeChartVersions.id, input.versionId))
        .limit(1);
      return refreshed ?? null;
    });
  }

  /** Returns null if not found. */
  async findById(versionId: number): Promise<VersionRow | null> {
    const [row] = await this.db
      .select()
      .from(brandSizeChartVersions)
      .where(eq(brandSizeChartVersions.id, versionId))
      .limit(1);
    return row ?? null;
  }

  async reject(input: RejectInput): Promise<void> {
    if (!input.reason.trim()) throw new Error("reject requires a reason");
    await this.db
      .update(brandSizeChartVersions)
      .set({ status: "rejected", rejectionReason: input.reason })
      .where(eq(brandSizeChartVersions.id, input.versionId));
  }

  /**
   * Invariant: supersede all OTHER accepted versions for this brand, then point brand
   * pointer at the newly accepted version. Must be called inside an existing transaction.
   */
  private async _promoteAcceptedTx(
    tx: Tx,
    brandId: number,
    acceptedVersionId: number
  ): Promise<void> {
    // Supersede any currently-accepted versions for this brand that are NOT the new one.
    await tx
      .update(brandSizeChartVersions)
      .set({ status: "superseded" })
      .where(
        and(
          eq(brandSizeChartVersions.brandId, brandId),
          eq(brandSizeChartVersions.status, "accepted"),
          ne(brandSizeChartVersions.id, acceptedVersionId)
        )
      );
    // Point the brand at the new accepted version.
    await tx
      .update(brands)
      .set({ currentSizeChartVersionId: acceptedVersionId })
      .where(eq(brands.id, brandId));
  }
}
