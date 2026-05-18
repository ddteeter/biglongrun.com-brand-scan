import { registerHandler, type Queue } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import type { ArtifactStore } from "../infrastructure/artifacts";
import type { PipelineDeps } from "../domain/extraction";
import type { DiscoverDeps } from "../domain/catalog";
import type { PushoverClient } from "../infrastructure/external/pushover";
import type { FirecrawlClient } from "../infrastructure/external/firecrawl";
import type { AnthropicClient } from "../infrastructure/external/anthropic";
import { makeExtractBrandSourceHandler } from "./extract-brand-source";
import { makeDetectBrandSourceChangesHandler } from "./detect-brand-source-changes";
import { makeSweepAllBrandSourcesHandler } from "./sweep-all-brand-sources";
import { makeDetectStuckJobsHandler } from "./detect-stuck-jobs";
import { makeScoreBrandHandler } from "./score-brand";
import { makeRecomputeCohortSummaryHandler } from "./recompute-cohort-summary";
import { makeDiscoverBrandCatalogHandler } from "./discover-brand-catalog";
import { makeClassifyItemTierHandler } from "./classify-item-tier";
import { makeComputeBrandCadenceHandler } from "./compute-brand-cadence";
import { makeSweepAllBrandCatalogsHandler } from "./sweep-all-brand-catalogs";

export interface RegisterJobsArgs {
  db: DB;
  queue: Queue;
  artifactStore: ArtifactStore;
  pushover: PushoverClient;
  firecrawl: FirecrawlClient;
  anthropic: AnthropicClient;
  recordUsage: (input: {
    provider: "anthropic" | "firecrawl";
    unitsUsed: number;
    unitsKind: string;
    estimatedCostUsd: number;
  }) => Promise<void>;
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
  registerHandler(
    "classify-item-tier",
    makeClassifyItemTierHandler({
      db: args.db,
      firecrawl: args.firecrawl,
      anthropic: args.anthropic,
      recordUsage: args.recordUsage,
    })
  );
  registerHandler("compute-brand-cadence", makeComputeBrandCadenceHandler({ db: args.db }));
  registerHandler(
    "sweep-all-brand-catalogs",
    makeSweepAllBrandCatalogsHandler({ db: args.db, queue: args.queue })
  );
}
