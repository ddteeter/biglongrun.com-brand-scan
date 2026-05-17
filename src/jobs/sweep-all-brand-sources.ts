import { eq } from "drizzle-orm";
import type { JobHandler, Queue } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import { brands } from "../infrastructure/db/schema";

export function makeSweepAllBrandSourcesHandler(args: { db: DB; queue: Queue }): JobHandler {
  return async () => {
    const active = await args.db.select().from(brands).where(eq(brands.active, true));
    for (const b of active) {
      await args.queue.enqueue({
        jobType: "detect-brand-source-changes",
        payload: { brandId: b.id },
        dedupeKey: `detect-brand-source-changes:${String(b.id)}:${new Date().toISOString().slice(0, 7)}`,
      });
    }
  };
}
