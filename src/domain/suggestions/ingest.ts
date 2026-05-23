import type { BrandService } from "../brands";
import { brandSlugFromName } from "../brands/slug";
import { estimateAnthropicCost, MODEL_HAIKU } from "../../infrastructure/external";
import type { Provider } from "../usage";
import type { RedditRssClient, RedditPost } from "./reddit-client";
import type { BrandSuggestionService } from "./service";
import type { ExtractResult } from "./extractor";

export interface IngestDeps {
  redditClient: RedditRssClient;
  suggestionService: BrandSuggestionService;
  brandService: BrandService;
  extract: (post: RedditPost) => Promise<ExtractResult>;
  recordUsage: (input: {
    provider: Provider;
    unitsUsed: number;
    unitsKind: string;
    estimatedCostUsd: number;
  }) => Promise<void>;
}

export interface IngestSubredditResult {
  postsFetched: number;
  candidatesProposed: number;
  suggestionsCreated: number;
  /** brand already exists in the brands table — no suggestion needed */
  suggestionsSkippedExisting: number;
  /** another pending suggestion for the same slug already exists */
  suggestionsSkippedDuplicate: number;
}

/**
 * Fetches a subreddit's RSS feed, extracts brand candidates from each post via Claude,
 * and inserts new suggestions while deduping against existing brands + pending suggestions.
 * Returns counts for the caller to record in the run summary.
 */
export async function ingestSubreddit(
  deps: IngestDeps,
  subreddit: string
): Promise<IngestSubredditResult> {
  const posts = await deps.redditClient.fetchSubreddit(subreddit);
  let candidatesProposed = 0;
  let suggestionsCreated = 0;
  let suggestionsSkippedExisting = 0;
  let suggestionsSkippedDuplicate = 0;

  for (const post of posts) {
    const result = await deps.extract(post);
    await deps.recordUsage({
      provider: "anthropic",
      unitsUsed: result.usage.inputTokens + result.usage.outputTokens,
      unitsKind: "tokens",
      estimatedCostUsd: estimateAnthropicCost(result.usage, MODEL_HAIKU),
    });
    candidatesProposed += result.candidates.length;

    for (const candidate of result.candidates) {
      const slug = brandSlugFromName(candidate.brandName);

      // Dedup layer 1: brand already exists
      const existingBrand = await deps.brandService.findBySlug(slug);
      if (existingBrand) {
        suggestionsSkippedExisting++;
        continue;
      }

      // Dedup layer 2: pending suggestion already exists for this slug
      // BrandSuggestionService.create is idempotent on (slug, status='pending') —
      // before/after count tells us whether THIS call inserted a new row.
      const before = await deps.suggestionService.countPendingForSlug(slug);
      await deps.suggestionService.create({
        suggestedBrandName: candidate.brandName,
        suggestedSlug: slug,
        sourceSubreddit: subreddit,
        sourcePostUrl: post.url,
        sourcePostTitle: post.title,
        sourceContext: candidate.contextExcerpt,
        plusSizePriority: candidate.plusSizeSignal,
      });
      const after = await deps.suggestionService.countPendingForSlug(slug);
      if (after > before) suggestionsCreated++;
      else suggestionsSkippedDuplicate++;
    }
  }

  return {
    postsFetched: posts.length,
    candidatesProposed,
    suggestionsCreated,
    suggestionsSkippedExisting,
    suggestionsSkippedDuplicate,
  };
}
