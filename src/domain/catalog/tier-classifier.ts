import { z } from "zod";
import { type AnthropicClient, MODEL_HAIKU } from "../../infrastructure/external";

export type Tier = "flagship" | "mid" | "basic" | "unclassified";

export interface TierResult {
  tier: Tier;
  reason: string;
}

export interface TierBuckets {
  basicMax: number;
  flagshipMin: number;
  cohortSize: number;
}

const MIN_COHORT_FOR_HEURISTIC = 4;
const BASIC_PERCENTILE = 0.25;
const FLAGSHIP_PERCENTILE = 0.75;

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor((sorted.length - 1) * p);
  const v = sorted[idx];
  if (v === undefined) throw new Error("empty cohort");
  return v;
}

export function computeBuckets(cohortPrices: number[]): TierBuckets | null {
  const priced = cohortPrices.filter((p) => Number.isFinite(p) && p > 0);
  if (priced.length < MIN_COHORT_FOR_HEURISTIC) return null;
  const sorted = priced.toSorted((a, b) => a - b);
  return {
    basicMax: percentile(sorted, BASIC_PERCENTILE),
    flagshipMin: percentile(sorted, FLAGSHIP_PERCENTILE),
    cohortSize: priced.length,
  };
}

export function classifyByPricePercentile(
  price: number | null,
  cohortPrices: number[]
): TierResult {
  if (price === null || !Number.isFinite(price) || price <= 0) {
    return { tier: "unclassified", reason: "no price" };
  }
  const buckets = computeBuckets(cohortPrices);
  if (!buckets) return { tier: "unclassified", reason: "cohort too small" };
  if (price <= buckets.basicMax)
    return {
      tier: "basic",
      reason: `price ${String(price)} <= basic cap ${String(buckets.basicMax)}`,
    };
  if (price >= buckets.flagshipMin)
    return {
      tier: "flagship",
      reason: `price ${String(price)} >= flagship floor ${String(buckets.flagshipMin)}`,
    };
  return {
    tier: "mid",
    reason: `price ${String(price)} between ${String(buckets.basicMax)} and ${String(buckets.flagshipMin)}`,
  };
}

// ---------------------------------------------------------------------------
// AI tier refiner
// ---------------------------------------------------------------------------

const TierEnum = z.enum(["flagship", "mid", "basic", "unclassified"]);
const RefineResponseSchema = z.object({
  tier: TierEnum,
  rationale: z.string().max(200),
  confidence: z.number().min(0).max(1),
});

export interface RefineInput {
  client: AnthropicClient;
  itemName: string;
  itemMarkdown: string;
  basePriceUsd: number | null;
  heuristic: TierResult;
}

export interface RefineResult {
  tier: Tier;
  rationale: string;
  confidence: number;
  usage: { inputTokens: number; outputTokens: number };
}

const SYSTEM_PROMPT = `You classify running-apparel products into tiers that reflect their positioning within the brand's lineup.

Tier definitions:
- flagship: the brand's top-of-line / hero products — technical fabrics (Merino, Gore-Tex, recycled nylon), highest price point, prominently featured in marketing, designed for race or performance use. Examples: race-day singlets, premium waterproof shells, carbon-plate race shoes.
- mid: solid everyday-performance products — polyester or standard technical blends, mid-range price, suitable for training runs and general use. Most items in a running brand's catalog land here.
- basic: entry-level or lifestyle items — cotton, casual tees, simple accessories (headbands, socks), recovery/lounge gear, or anything clearly not performance-positioned.
- unclassified: use when you have insufficient signal to place the item (e.g., no price, no meaningful product description, ambiguous category).

Output keys:
- tier: one of "flagship", "mid", "basic", "unclassified"
- rationale: <=200 chars explaining the key signal that drove your classification (cite material, price cue, or marketing language)
- confidence: 0–1, how certain you are given the available page content

Inputs: a heuristic prior (from price-percentile bucketing), the product name, and the rendered product-page markdown.
Use the heuristic prior as a starting anchor. Override only when the page provides clear contradicting signal (e.g., the heuristic says "flagship" but the page describes a cotton gym tee).`;

export async function refineWithAi(input: RefineInput): Promise<RefineResult> {
  const priceStr = input.basePriceUsd === null ? "(unknown)" : String(input.basePriceUsd);
  const resp = await input.client.extractStructured({
    model: MODEL_HAIKU,
    systemPrompt: SYSTEM_PROMPT,
    userText: `Item: ${input.itemName}\nBase price USD: ${priceStr}\nHeuristic prior: ${input.heuristic.tier} (${input.heuristic.reason})\n\nPage markdown:\n${input.itemMarkdown}`,
    maxTokens: 256,
  });
  const parsed = RefineResponseSchema.parse(resp.parsed);
  return {
    tier: parsed.tier,
    rationale: parsed.rationale,
    confidence: parsed.confidence,
    usage: resp.usage,
  };
}
