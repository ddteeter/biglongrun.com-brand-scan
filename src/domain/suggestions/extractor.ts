import { z } from "zod";
import { type AnthropicClient, MODEL_HAIKU } from "../../infrastructure/external";
import type { RedditPost } from "./reddit-client";

const CandidatesSchema = z.object({
  candidates: z.array(
    z.object({
      brand_name: z.string().min(1),
      context_excerpt: z.string().max(280),
      plus_size_signal: z.boolean(),
    })
  ),
});

const SYSTEM_PROMPT = `You scan a Reddit post about running for mentions of running-apparel brand names.

Your output: a JSON object with one key, "candidates", an array. Each candidate is:
- brand_name: the brand's display name as commonly known (e.g., "Path Projects", "Tracksmith", "Janji"). Use the canonical brand name, NOT a product line within a brand.
- context_excerpt: a ≤280-character excerpt from the post showing where/how this brand was mentioned.
- plus_size_signal: true ONLY if the brand was mentioned in a clearly plus-size or size-inclusivity context — e.g., the post is about size availability, extended sizes, or the brand was recommended specifically for plus-size runners. Most mentions will be false. If the post is from r/PlusSizeFitness, default plus_size_signal=true unless the post explicitly excludes plus-size relevance.

ONLY include brands that:
- Sell running APPAREL (not shoes-only, not nutrition/supplements, not accessories like watches)
- Are mentioned by name in the post

EXCLUDE:
- Shoe-only brands (Hoka, Saucony, Brooks shoe line — these are typically tracked separately)
- Tech brands (Garmin, Coros, Apple, Polar)
- Nutrition/hydration (Maurten, Tailwind, Liquid I.V.)
- Generic mentions like "running brands" without a specific name
- Personal nicknames or unclear references

If no apparel brands are mentioned, return { "candidates": [] }. Be conservative — false positives waste editor review time.`;

export interface ExtractInput {
  client: AnthropicClient;
  post: RedditPost;
}

export interface ExtractedCandidate {
  brandName: string;
  contextExcerpt: string;
  plusSizeSignal: boolean;
}

export interface ExtractResult {
  candidates: ExtractedCandidate[];
  usage: { inputTokens: number; outputTokens: number };
}

export async function extractBrandMentions(input: ExtractInput): Promise<ExtractResult> {
  const resp = await input.client.extractStructured({
    model: MODEL_HAIKU,
    systemPrompt: SYSTEM_PROMPT,
    userText: `Subreddit: r/${input.post.subreddit}\nTitle: ${input.post.title}\n\nBody:\n${input.post.selftext}`,
    maxTokens: 1024,
  });
  const parsed = CandidatesSchema.parse(resp.parsed);
  return {
    candidates: parsed.candidates.map((c) => ({
      brandName: c.brand_name,
      contextExcerpt: c.context_excerpt,
      plusSizeSignal: c.plus_size_signal,
    })),
    usage: resp.usage,
  };
}
