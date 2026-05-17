import { registerHandler, type Queue } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import type { ArtifactStore } from "../infrastructure/artifacts";
import type { PipelineDeps } from "../domain/extraction";
import type { PushoverClient } from "../infrastructure/external/pushover";
import { makeExtractBrandSourceHandler } from "./extract-brand-source";
import { makeDetectBrandSourceChangesHandler } from "./detect-brand-source-changes";
import { makeSweepAllBrandSourcesHandler } from "./sweep-all-brand-sources";
import { makeDetectStuckJobsHandler } from "./detect-stuck-jobs";

export interface RegisterJobsArgs {
  db: DB;
  queue: Queue;
  artifactStore: ArtifactStore;
  pushover: PushoverClient;
  buildPipelineDeps: (runId: number) => PipelineDeps;
}

export function registerJobs(args: RegisterJobsArgs): void {
  registerHandler(
    "extract-brand-source",
    makeExtractBrandSourceHandler({
      db: args.db,
      artifactStore: args.artifactStore,
      buildPipelineDeps: args.buildPipelineDeps,
    })
  );
  registerHandler(
    "detect-brand-source-changes",
    makeDetectBrandSourceChangesHandler({ db: args.db, queue: args.queue })
  );
  registerHandler(
    "sweep-all-brand-sources",
    makeSweepAllBrandSourcesHandler({ db: args.db, queue: args.queue })
  );
  registerHandler(
    "detect-stuck-jobs",
    makeDetectStuckJobsHandler({ db: args.db, pushover: args.pushover })
  );
}
