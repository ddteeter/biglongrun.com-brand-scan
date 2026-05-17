import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brandSources, brandSizeChartVersions, brands } from "../../infrastructure/db/schema";
import type { FirecrawlClient } from "../../infrastructure/external/firecrawl";
import type { AnthropicClient } from "../../infrastructure/external/anthropic";
import { DomainRateLimiter } from "../../infrastructure/external";
import { parseDeterministic } from "./parser-deterministic";
import { extractWithClaude } from "./extractor-claude";
import { validateStructural } from "./validators";
import { compositeConfidence } from "./confidence";
import { cohortOutlierFactor, type CohortSummary } from "./outlier";
import { assemblePriorContext } from "./prior-context";
import type { CanonicalSizeChart } from "./canonical";

export interface PipelineDeps {
  db: DB;
  firecrawl: FirecrawlClient;
  anthropic: AnthropicClient;
  rateLimiter: DomainRateLimiter;
  cohortSummary: CohortSummary | null;
  saveScreenshot: (bytes: Uint8Array, runId: number) => Promise<string>;
  notifyPendingReview: (input: {
    brandSlug: string;
    brandName: string;
    versionId: number;
    reason: string;
  }) => Promise<void>;
  publicBaseUrl: string;
  recordUsage: (input: {
    provider: "firecrawl" | "anthropic";
    unitsUsed: number;
    unitsKind: string;
    estimatedCostUsd: number;
    runId?: number;
  }) => Promise<void>;
}

export interface PipelineInput {
  brandSourceId: number;
  runId: number;
}

export type PipelineOutcome =
  | { kind: "unchanged" }
  | { kind: "auto_accepted"; versionId: number }
  | { kind: "pending_review"; versionId: number; reason: string };

const AUTO_ACCEPT_CONFIDENCE_THRESHOLD = 0.85;
const LOW_CONFIDENCE_THRESHOLD = 0.4;
const DELTA_LARGE_THRESHOLD = 3; // # of measurement fields changed
const FIRECRAWL_COST_PER_PAGE = 0; // free tier; we still track pages

function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function countMeasurementDeltas(prev: CanonicalSizeChart | null, next: CanonicalSizeChart): number {
  if (!prev) return 0;
  let count = 0;
  const allLabels = new Set([...prev.size_labels, ...next.size_labels]);
  for (const label of allLabels) {
    const p = prev.measurements[label];
    const n = next.measurements[label];
    if (!p || !n) {
      count += 3;
      continue;
    }
    for (const k of ["chest_in", "waist_in", "hip_in"] as const) {
      if (JSON.stringify(p[k]) !== JSON.stringify(n[k])) count++;
    }
  }
  return count;
}

export async function runExtraction(
  deps: PipelineDeps,
  input: PipelineInput
): Promise<PipelineOutcome> {
  const [source] = await deps.db
    .select()
    .from(brandSources)
    .where(eq(brandSources.id, input.brandSourceId))
    .limit(1);
  if (!source) {
    throw new Error(`brand_source not found: ${String(input.brandSourceId)}`);
  }

  // 1. Rate gate
  const host = DomainRateLimiter.extractHost(source.url);
  await deps.rateLimiter.wait(host);
  deps.rateLimiter.record(host);

  // 2. Cheap change detection — build conditional headers and call HEAD-like fetch
  const conditional: { etag?: string; lastModified?: string } = {};
  if (source.lastEtag) conditional.etag = source.lastEtag;
  if (source.lastModifiedHeader) conditional.lastModified = source.lastModifiedHeader;

  const nowIso = new Date().toISOString();
  const unchanged = await checkForChanges(deps, source, conditional, nowIso, input.brandSourceId);
  if (unchanged !== null) return unchanged;

  // 3. Render (paid)
  const render = await deps.firecrawl.render(source.url);
  await deps.recordUsage({
    provider: "firecrawl",
    unitsUsed: 1,
    unitsKind: "pages",
    estimatedCostUsd: FIRECRAWL_COST_PER_PAGE,
    runId: input.runId,
  });
  await deps.saveScreenshot(render.screenshotBytes, input.runId);

  // 4. Prior context
  const priorContext = await assemblePriorContext(deps.db, source.brandId);

  // 5. Extraction (tiered)
  const extracted = await tieredExtraction(deps, source, render, priorContext, input.runId);
  const { chart, reportedConfidence } = extracted;

  // 6. Structural validation (authoritative score on whichever method produced chart)
  const structural = validateStructural(chart);

  // 7. Cohort outlier
  const outlierFactor = cohortOutlierFactor(chart, deps.cohortSummary);

  // 8. Composite confidence
  const conf = compositeConfidence({
    claudeReported: reportedConfidence,
    structuralValidation: structural.score,
    cohortOutlier: outlierFactor,
  });

  // 9. Delta vs prior accepted
  const deltaCount = countMeasurementDeltas(priorContext.lastAccepted, chart);
  if (priorContext.lastAccepted && deltaCount === 0) {
    return { kind: "unchanged" };
  }

  // 10. Route and persist
  return persistAndRoute(deps, source, chart, conf, deltaCount, priorContext, nowIso, input.runId);
}

// ---------------------------------------------------------------------------
// Private helpers extracted to keep runExtraction's cognitive complexity low
// ---------------------------------------------------------------------------

async function checkForChanges(
  deps: PipelineDeps,
  source: {
    id: number;
    url: string;
    lastFetchHash: string | null;
    lastEtag: string | null;
    lastModifiedHeader: string | null;
  },
  conditional: { etag?: string; lastModified?: string },
  nowIso: string,
  brandSourceId: number
): Promise<{ kind: "unchanged" } | null> {
  const head = await deps.firecrawl.headOnly(source.url, conditional);
  if (head.kind === "unchanged") {
    await deps.db
      .update(brandSources)
      .set({ lastFetchedAt: nowIso })
      .where(eq(brandSources.id, brandSourceId));
    return { kind: "unchanged" };
  }
  const newHash = hashBody(head.body);
  if (source.lastFetchHash === newHash) {
    await deps.db
      .update(brandSources)
      .set({
        lastFetchedAt: nowIso,
        lastEtag: head.etag,
        lastModifiedHeader: head.lastModified,
      })
      .where(eq(brandSources.id, brandSourceId));
    return { kind: "unchanged" };
  }
  await deps.db
    .update(brandSources)
    .set({
      lastFetchedAt: nowIso,
      lastChangedAt: nowIso,
      lastFetchHash: newHash,
      lastEtag: head.etag,
      lastModifiedHeader: head.lastModified,
    })
    .where(eq(brandSources.id, brandSourceId));
  return null;
}

interface TieredResult {
  chart: CanonicalSizeChart;
  reportedConfidence: number;
}

async function tieredExtraction(
  deps: PipelineDeps,
  source: { url: string },
  render: { markdown: string; screenshotBytes: Uint8Array },
  priorContext: Awaited<ReturnType<typeof assemblePriorContext>>,
  runId: number
): Promise<TieredResult> {
  let chart: CanonicalSizeChart | null = parseDeterministic(render.markdown, source.url);
  let reportedConfidence = 0.95;
  if (chart) {
    const structural = validateStructural(chart);
    if (structural.score < 0.8) chart = null;
  }
  if (!chart) {
    const result = await extractWithClaude({
      client: deps.anthropic,
      sourceUrl: source.url,
      markdown: render.markdown,
      screenshotPng: render.screenshotBytes,
      priorContext,
    });
    chart = result.chart;
    reportedConfidence = result.reportedConfidence;
    await deps.recordUsage({
      provider: "anthropic",
      unitsUsed: result.usage.inputTokens + result.usage.outputTokens,
      unitsKind: "tokens",
      estimatedCostUsd: (result.usage.inputTokens * 3 + result.usage.outputTokens * 15) / 1_000_000,
      runId,
    });
  }
  return { chart, reportedConfidence };
}

async function persistAndRoute(
  deps: PipelineDeps,
  source: { id: number; brandId: number },
  chart: CanonicalSizeChart,
  conf: ReturnType<typeof compositeConfidence>,
  deltaCount: number,
  priorContext: Awaited<ReturnType<typeof assemblePriorContext>>,
  nowIso: string,
  _runId: number
): Promise<PipelineOutcome> {
  const status =
    conf.composite >= AUTO_ACCEPT_CONFIDENCE_THRESHOLD && deltaCount <= DELTA_LARGE_THRESHOLD
      ? "accepted"
      : "pending_review";

  const inserted = await deps.db
    .insert(brandSizeChartVersions)
    .values({
      brandId: source.brandId,
      brandSourceId: source.id,
      sourceRunId: _runId,
      sizeChartJson: chart as Record<string, unknown>,
      confidenceScore: conf.composite,
      confidenceBreakdownJson: conf.breakdown,
      status,
      acceptedAt: status === "accepted" ? nowIso : null,
      acceptedBy: status === "accepted" ? "auto" : null,
      supersedesVersionId: null,
      deltaFromPriorJson: priorContext.lastAccepted ? { fieldsChanged: deltaCount } : null,
    })
    .returning();

  const version = inserted[0];
  if (!version) throw new Error("Failed to insert brand_size_chart_version");

  if (status === "accepted") {
    if (priorContext.lastAccepted) {
      // Supersede all previously accepted versions (including the just-inserted row if it was
      // already accepted), then re-mark the new row as accepted.
      await deps.db
        .update(brandSizeChartVersions)
        .set({ status: "superseded" })
        .where(
          and(
            eq(brandSizeChartVersions.brandId, source.brandId),
            eq(brandSizeChartVersions.status, "accepted")
          )
        );
      await deps.db
        .update(brandSizeChartVersions)
        .set({ status: "accepted" })
        .where(eq(brandSizeChartVersions.id, version.id));
    }
    await deps.db
      .update(brands)
      .set({ currentSizeChartVersionId: version.id })
      .where(eq(brands.id, source.brandId));
    return { kind: "auto_accepted", versionId: version.id };
  }

  // pending_review: notify
  const [brand] = await deps.db.select().from(brands).where(eq(brands.id, source.brandId)).limit(1);
  if (!brand) throw new Error(`brand not found: ${String(source.brandId)}`);
  const reason =
    conf.composite < LOW_CONFIDENCE_THRESHOLD ? "low confidence" : "size chart materially changed";
  await deps.notifyPendingReview({
    brandSlug: brand.slug,
    brandName: brand.name,
    versionId: version.id,
    reason,
  });
  return { kind: "pending_review", versionId: version.id, reason };
}
