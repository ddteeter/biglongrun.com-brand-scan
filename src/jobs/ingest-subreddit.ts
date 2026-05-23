import { z } from "zod";
import { eq } from "drizzle-orm";
import type { JobHandler } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import { runs } from "../infrastructure/db/schema";
import { ingestSubreddit, type IngestDeps } from "../domain/suggestions";

const PayloadSchema = z.object({ subreddit: z.string().min(1).max(100) });

export interface MakeArgs {
  db: DB;
  buildIngestDeps: () => IngestDeps;
}

async function finishRun(db: DB, runId: number, summary: Record<string, unknown>): Promise<void> {
  await db
    .update(runs)
    .set({ finishedAt: new Date().toISOString(), ...summary })
    .where(eq(runs.id, runId));
}

export function makeIngestSubredditHandler(args: MakeArgs): JobHandler {
  // Transactional boundary note: the outer handler is intentionally NOT wrapped in a
  // single db.transaction. Each BrandSuggestionService.create call is internally
  // idempotent and atomic; a partial failure mid-iteration should still leave a runs
  // row with status='failed' so it shows up in admin + Pushover. Same pattern as
  // extract-brand-source and discover-brand-catalog.
  return async (rawPayload, ctx) => {
    const { subreddit } = PayloadSchema.parse(rawPayload);

    const [run] = await args.db
      .insert(runs)
      .values({ jobId: ctx.jobId, status: "running" })
      .returning();
    if (!run) throw new Error("runs insert returned empty");

    try {
      const result = await ingestSubreddit(args.buildIngestDeps(), subreddit);
      await finishRun(args.db, run.id, {
        status: "succeeded",
        summaryJson: { subreddit, ...result },
      });
    } catch (error) {
      await finishRun(args.db, run.id, {
        status: "failed",
        summaryJson: { subreddit, error: (error as Error).message },
      });
      throw error;
    }
  };
}
