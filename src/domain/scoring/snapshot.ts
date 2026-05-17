import { desc, eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brandScoreHistory, brandScoreSnapshots } from "../../infrastructure/db/schema";
import {
  MIN_COHORT_SIZE_FOR_PUBLIC,
  SNAPSHOT_PROMOTION_DELTA,
  SUSTAINED_DIRECTION_WINDOW,
  SNAPSHOT_HEARTBEAT_DAYS,
} from "./config";

export interface PromoteOptions {
  db: DB;
  brandId: number;
  latestHistoryId: number;
  cohortSummaryId: number;
  cohortBrandCount: number;
}

export interface PromoteResult {
  promoted: boolean;
  reason: "first" | "sustained_shift" | "heartbeat" | "no_change";
}

function getComposite(scoresJson: unknown): number {
  return (scoresJson as { composite: number }).composite;
}

export async function promoteSnapshotIfWarranted(opts: PromoteOptions): Promise<PromoteResult> {
  const [latest] = await opts.db
    .select()
    .from(brandScoreHistory)
    .where(eq(brandScoreHistory.id, opts.latestHistoryId))
    .limit(1);
  if (!latest) return { promoted: false, reason: "no_change" };

  const isPublic = opts.cohortBrandCount >= MIN_COHORT_SIZE_FOR_PUBLIC;
  const currentComposite = getComposite(latest.scoresJson);

  const [lastSnapshot] = await opts.db
    .select()
    .from(brandScoreSnapshots)
    .where(eq(brandScoreSnapshots.brandId, opts.brandId))
    .orderBy(desc(brandScoreSnapshots.snapshotAt))
    .limit(1);

  const insertSnapshot = async (reason: PromoteResult["reason"]): Promise<PromoteResult> => {
    await opts.db.insert(brandScoreSnapshots).values({
      brandId: opts.brandId,
      promotedFromHistoryId: opts.latestHistoryId,
      cohortSummaryId: opts.cohortSummaryId,
      scoresJson: latest.scoresJson,
      isPublic,
    });
    return { promoted: true, reason };
  };

  if (!lastSnapshot) return insertSnapshot("first");

  const heartbeatStale =
    Date.now() - new Date(lastSnapshot.snapshotAt).getTime() > SNAPSHOT_HEARTBEAT_DAYS * 86_400_000;
  if (heartbeatStale) return insertSnapshot("heartbeat");

  const recent = await opts.db
    .select()
    .from(brandScoreHistory)
    .where(eq(brandScoreHistory.brandId, opts.brandId))
    .orderBy(desc(brandScoreHistory.computedAt))
    .limit(SUSTAINED_DIRECTION_WINDOW);
  if (recent.length < SUSTAINED_DIRECTION_WINDOW) return { promoted: false, reason: "no_change" };

  const composites = recent.map((r) => getComposite(r.scoresJson));
  const lastSnapComposite = getComposite(lastSnapshot.scoresJson);
  const delta = Math.abs(currentComposite - lastSnapComposite);

  // composites are in desc-time order, so composites[0] is most recent
  const allIncreasing = composites.every((v, i) => {
    if (i === 0) return true;
    const prev = composites[i - 1];
    return prev !== undefined && prev < v;
  });
  const allDecreasing = composites.every((v, i) => {
    if (i === 0) return true;
    const prev = composites[i - 1];
    return prev !== undefined && prev > v;
  });

  if (delta >= SNAPSHOT_PROMOTION_DELTA && (allIncreasing || allDecreasing)) {
    return insertSnapshot("sustained_shift");
  }
  return { promoted: false, reason: "no_change" };
}
