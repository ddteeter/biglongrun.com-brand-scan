import { z } from "zod";
import { MODEL_SONNET, type AnthropicClient } from "../../infrastructure/external";
import { PerSizeDataSchema, type ItemDraft, type PerSizeData } from "./types";

const ClaudeItemSchema = z.object({
  name: z.string(),
  category: z.string(),
  base_price_usd: z.number().nullable(),
  per_size: PerSizeDataSchema,
  confidence: z.number().min(0).max(1),
});

const SYSTEM_PROMPT = `You extract running-apparel product details into normalized JSON.
Inputs: rendered markdown of a single product page and a screenshot.
Output exactly one JSON object with keys:
- name (string): product display name
- category (string): apparel category — tops, bottoms, shorts, outerwear, accessories, etc.
- base_price_usd (number | null): list price in USD
- per_size (object): map of size label → { available: boolean, price?: number, colors?: string[] }
- confidence (number 0–1)
If you cannot identify a recognizable product, return confidence < 0.3 and a best-effort name like "(unidentified)".`;

export interface ExtractItemInput {
  client: AnthropicClient;
  brandId: number;
  sourceUrl: string;
  markdown: string;
  screenshotPng?: Uint8Array;
}

export interface ExtractItemResult {
  draft: ItemDraft;
  confidence: number;
  usage: { inputTokens: number; outputTokens: number };
}

export async function extractItemDetail(input: ExtractItemInput): Promise<ExtractItemResult> {
  const resp = await input.client.extractStructured({
    model: MODEL_SONNET,
    systemPrompt: SYSTEM_PROMPT,
    userText: `Source URL: ${input.sourceUrl}\n\nMarkdown:\n${input.markdown}`,
    ...(input.screenshotPng ? { userImagePngBytes: input.screenshotPng } : {}),
    maxTokens: 1024,
  });
  const parsed = ClaudeItemSchema.parse(resp.parsed);
  const perSize: PerSizeData = {};
  for (const [label, value] of Object.entries(parsed.per_size)) {
    perSize[label] = {
      available: value.available,
      ...(value.price === undefined ? {} : { price: value.price }),
      ...(value.colors === undefined ? {} : { colors: value.colors }),
    };
  }
  return {
    draft: {
      brandId: input.brandId,
      sourceUrl: input.sourceUrl,
      name: parsed.name,
      category: parsed.category || "uncategorized",
      basePriceUsd: parsed.base_price_usd,
      perSizeData: perSize,
    },
    confidence: parsed.confidence,
    usage: resp.usage,
  };
}
