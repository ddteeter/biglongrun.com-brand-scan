import { registerHandler, type Queue } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import type { ArtifactStore } from "../infrastructure/artifacts";
import type { PipelineDeps } from "../domain/extraction";
import type { DiscoverDeps } from "../domain/catalog";
import type { PushoverClient } from "../infrastructure/external/pushover";
import { makeExtractBrandSourceHandler } from "./extract-brand-source";
import { makeDetectBrandSourceChangesHandler } from "./detect-brand-source-changes";
import { makeSweepAllBrandSourcesHandler } from "./sweep-all-brand-sources";
import { makeDetectStuckJobsHandler } from "./detect-stuck-jobs";
import { makeScoreBrandHandler } from "./score-brand";
import { makeRecomputeCohortSummaryHandler } from "./recompute-cohort-summary";
import { makeDiscoverBrandCatalogHandler } from "./discover-brand-catalog";

export interface RegisterJobsArgs {
  db: DB;
  queue: Queue;
  artifactStore: ArtifactStore;
  pushover: PushoverClient;
  buildPipelineDeps: (runId: number) => PipelineDeps;
  buildDiscoverDeps: () => DiscoverDeps;
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
  registerHandler("score-brand", makeScoreBrandHandler({ db: args.db }));
  registerHandler(
    "recompute-cohort-summary",
    makeRecomputeCohortSummaryHandler({ db: args.db, queue: args.queue })
  );
  registerHandler(
    "discover-brand-catalog",
    makeDiscoverBrandCatalogHandler({
      db: args.db,
      buildDiscoverDeps: args.buildDiscoverDeps,
    })
  );
}
