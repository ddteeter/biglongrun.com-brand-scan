import { isNotNull } from "drizzle-orm";
import type { JobHandler } from "../infrastructure/queue";
import type { Queue } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import { recomputeCohortSummary } from "../domain/scoring";
import { brands } from "../infrastructure/db/schema";

export function makeRecomputeCohortSummaryHandler(args: { db: DB; queue: Queue }): JobHandler {
  return async () => {
    await recomputeCohortSummary({ db: args.db, trigger: "scheduled" });
    // Enqueue score-brand for every brand with a current size chart.
    const rows = await args.db
      .select({ id: brands.id })
      .from(brands)
      .where(isNotNull(brands.currentSizeChartVersionId));
    for (const r of rows) {
      await args.queue.enqueue({
        jobType: "score-brand",
        payload: { brandId: r.id },
        dedupeKey: `score-brand:${String(r.id)}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
  };
}
