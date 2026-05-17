import { z } from "zod";
import { eq } from "drizzle-orm";
import type { JobHandler } from "../infrastructure/queue";
import { runs, runArtifacts } from "../infrastructure/db/schema";
import { runExtraction, type PipelineDeps } from "../domain/extraction";
import type { DB } from "../infrastructure/db";
import type { ArtifactStore } from "../infrastructure/artifacts";

const PayloadSchema = z.object({ brandSourceId: z.number().int().positive() });

export function makeExtractBrandSourceHandler(args: {
  db: DB;
  artifactStore: ArtifactStore;
  buildPipelineDeps: (runId: number) => PipelineDeps;
}): JobHandler {
  return async (rawPayload, ctx) => {
    const { brandSourceId } = PayloadSchema.parse(rawPayload);

    const inserted = await args.db
      .insert(runs)
      .values({
        jobId: ctx.jobId,
        status: "running",
      })
      .returning();

    const run = inserted[0];
    if (!run) throw new Error("Failed to insert run row");

    const saveScreenshot = async (bytes: Uint8Array, runId: number): Promise<string> => {
      const stored = await args.artifactStore.save(bytes, runId, "png");
      await args.db.insert(runArtifacts).values({
        runId,
        kind: "screenshot",
        filePath: stored.filePath,
        bytes: bytes.byteLength,
        sha256: stored.sha256,
      });
      return stored.filePath;
    };

    const deps: PipelineDeps = { ...args.buildPipelineDeps(run.id), saveScreenshot };

    try {
      const outcome = await runExtraction(deps, { brandSourceId, runId: run.id });
      await args.db
        .update(runs)
        .set({
          finishedAt: new Date().toISOString(),
          status: "succeeded",
          summaryJson: outcome,
        })
        .where(eq(runs.id, run.id));
    } catch (error) {
      await args.db
        .update(runs)
        .set({
          finishedAt: new Date().toISOString(),
          status: "failed",
          summaryJson: { error: (error as Error).message },
        })
        .where(eq(runs.id, run.id));
      throw error;
    }
  };
}
