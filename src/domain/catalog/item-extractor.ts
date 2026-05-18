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
- name (string): product display name as shown on the page (not a slug or SKU)
- category (string): apparel category — one of: tops, bottoms, shorts, outerwear, accessories, footwear, base-layer, socks. Use the most specific label that fits; default to "accessories" only if none of the above apply. Note: "socks" is a distinct category (not accessories or footwear) — socks touch the body like apparel and have their own sizing dynamics (often S/M/L or shoe-size-correlated, distinct from both standard apparel and shoe sizing).
- base_price_usd (number | null): the standard list price in USD for the default/lowest variant; null if price is not shown
- per_size (object): map of size label → { available: boolean, price?: number, colors?: string[] }. Keys are the exact size labels the brand uses for THIS product (e.g. "XS", "S", "M", "L", "XL", "XXL", "28x30" for pants, etc.). Include ONLY sizes actually listed on this product page — do NOT copy from the brand's master size chart. "available" is true if the size is currently in stock. "price" is the variant price if it differs from base_price_usd. "colors" lists colorway names available for that size, if shown.
- confidence (number 0–1): your confidence that you correctly identified a single purchasable apparel product. Set < 0.3 if the page is a category listing, a lookbook, or you cannot identify a clear product.
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
