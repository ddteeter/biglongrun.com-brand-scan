import { z } from "zod";
import { eq } from "drizzle-orm";
import type { JobHandler, Queue } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import { brandSources } from "../infrastructure/db/schema";

const PayloadSchema = z.object({ brandId: z.number().int().positive() });

export function makeDetectBrandSourceChangesHandler(args: { db: DB; queue: Queue }): JobHandler {
  return async (rawPayload) => {
    const { brandId } = PayloadSchema.parse(rawPayload);
    const sources = await args.db
      .select()
      .from(brandSources)
      .where(eq(brandSources.brandId, brandId));
    for (const s of sources) {
      await args.queue.enqueue({
        jobType: "extract-brand-source",
        payload: { brandSourceId: s.id },
        dedupeKey: `extract-brand-source:${String(s.id)}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
  };
}
