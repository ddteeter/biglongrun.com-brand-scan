import { getEnv } from "./env";
import { createLogger } from "./logger";
import { getDb } from "./infrastructure/db";
import { runMigrations } from "./infrastructure/db/migrate";
import { Queue, QueueRunner, Scheduler } from "./infrastructure/queue";
import { FirecrawlClient } from "./infrastructure/external/firecrawl";
import { AnthropicClient } from "./infrastructure/external/anthropic";
import { PushoverClient } from "./infrastructure/external/pushover";
import { DomainRateLimiter } from "./infrastructure/external/rate-limiter";
import { ArtifactStore } from "./infrastructure/artifacts";
import { UsageTracker, CircuitBreaker } from "./domain/usage";
import { ShopifyCatalogDiscoverer, SitemapCatalogDiscoverer } from "./domain/catalog";
import { registerJobs } from "./jobs";
import { buildApp } from "./server/app";

const logger = createLogger({ level: "info" });
const bootedAt = new Date();

function boot(): void {
  const env = getEnv();
  logger.info("starting brand-scan");

  runMigrations();
  const db = getDb();

  const queue = new Queue(db);
  const artifactStore = new ArtifactStore(env.ARTIFACTS_PATH);
  const firecrawl = new FirecrawlClient({ apiKey: env.FIRECRAWL_API_KEY });
  const anthropic = new AnthropicClient({ apiKey: env.ANTHROPIC_API_KEY });
  const pushover = new PushoverClient({
    userKey: env.PUSHOVER_USER_KEY,
    appToken: env.PUSHOVER_APP_TOKEN,
  });
  const rateLimiter = new DomainRateLimiter({ minIntervalMs: 30_000 });
  const usageTracker = new UsageTracker(db);
  const shopify = new ShopifyCatalogDiscoverer();
  const sitemap = new SitemapCatalogDiscoverer();
  const circuitBreaker = new CircuitBreaker(db, {
    firecrawlMonthlyPages: env.FIRECRAWL_MONTHLY_PAGE_BUDGET,
    anthropicMonthlyUsd: env.ANTHROPIC_MONTHLY_USD_BUDGET,
  });

  registerJobs({
    db,
    queue,
    artifactStore,
    pushover,
    firecrawl,
    anthropic,
    recordUsage: (input) => usageTracker.record(input),
    buildDiscoverDeps: () => ({
      shopify,
      sitemap,
      firecrawl,
      anthropic,
      rateLimiter,
      recordUsage: (input) => usageTracker.record(input),
    }),
    buildPipelineDeps: () => ({
      db,
      firecrawl,
      anthropic,
      rateLimiter,
      cohortSummary: null,
      saveScreenshot: () => Promise.resolve("(handled in job)"),
      notifyPendingReview: async (input) => {
        const { brandName, versionId, reason } = input;
        await pushover.notify({
          title: `brand-scan: ${brandName} needs review`,
          message: `${reason}. Version ${String(versionId)}.`,
          url: `${env.PUBLIC_BASE_URL}/admin/queue`,
        });
      },
      publicBaseUrl: env.PUBLIC_BASE_URL,
      recordUsage: (input) => usageTracker.record(input),
    }),
  });

  const runner = new QueueRunner({ queue, pollIntervalMs: 30_000, heartbeatIntervalSecs: 30 });
  runner.start();

  const scheduler = new Scheduler();
  scheduler.register({
    name: "sweep-all-brand-sources",
    cron: "0 3 1 * *", // monthly, 1st at 03:00 UTC
    enqueue: async () => {
      await queue.enqueue({
        jobType: "sweep-all-brand-sources",
        payload: {},
        dedupeKey: `sweep:${new Date().toISOString().slice(0, 7)}`,
      });
    },
  });
  scheduler.register({
    name: "recompute-cohort-summary",
    cron: "0 4 * * 1", // weekly Mondays 04:00 UTC
    enqueue: async () => {
      await queue.enqueue({
        jobType: "recompute-cohort-summary",
        payload: {},
        dedupeKey: `cohort:${new Date().toISOString().slice(0, 10)}`,
      });
    },
  });
  scheduler.register({
    name: "detect-stuck-jobs",
    cron: "* * * * *", // every minute
    enqueue: async () => {
      await queue.enqueue({
        jobType: "detect-stuck-jobs",
        payload: {},
        dedupeKey: `stuck:${String(new Date().getMinutes())}`,
      });
    },
  });
  scheduler.register({
    name: "compute-brand-cadence",
    cron: "0 5 * * 1", // weekly Mondays 05:00 UTC
    enqueue: async () => {
      await queue.enqueue({
        jobType: "compute-brand-cadence",
        payload: {},
        dedupeKey: `compute-brand-cadence:${new Date().toISOString().slice(0, 10)}`,
      });
    },
  });
  scheduler.start();

  const app = buildApp({
    db,
    queue,
    bearerToken: env.BLOG_API_TOKEN,
    sessionSecret: env.SESSION_SECRET,
    adminPasswordHash: env.ADMIN_PASSWORD_HASH,
    authorSlug: "drew",
    artifactsLocalPath: env.ARTIFACTS_PATH,
    artifactsPublicBaseUrl: "/artifacts",
    circuitBreaker,
    bootedAt,
  });

  app.listen(3000);
  logger.info({ port: 3000 }, "brand-scan listening");
}

try {
  boot();
} catch (error) {
  logger.error(
    {
      err: {
        message: (error as Error).message,
        stack: (error as Error).stack,
      },
    },
    "boot failed"
  );
  process.exit(1);
}
