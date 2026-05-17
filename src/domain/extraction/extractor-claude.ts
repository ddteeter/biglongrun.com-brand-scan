import { z } from "zod";
import { CanonicalSizeChartSchema, type CanonicalSizeChart } from "./canonical";
import type { AnthropicClient } from "../../infrastructure/external";
import { MODEL_SONNET } from "../../infrastructure/external";

const ClaudeResponseSchema = z.object({
  chart: z.object({
    size_labels: z.array(z.string()),
    measurements: z.record(
      z.string(),
      z.object({
        chest_in: z.tuple([z.number(), z.number()]),
        waist_in: z.tuple([z.number(), z.number()]),
        hip_in: z.tuple([z.number(), z.number()]),
      })
    ),
    size_availability: z.array(
      z.object({
        category: z.string(),
        available_sizes: z.array(z.string()),
      })
    ),
    notes: z.string().default(""),
    gender_specific: z.union([z.literal(false), z.enum(["men", "women", "unisex"])]),
  }),
  overall_confidence: z.number().min(0).max(1),
  per_field_confidence: z.record(z.string(), z.number().min(0).max(1)).optional(),
  what_i_saw: z.string(),
});

export interface PriorContext {
  lastAccepted: CanonicalSizeChart | null;
  assessments: {
    authorSlug: string;
    ratings: Record<string, number>;
    proseMarkdown: string;
  }[];
  corrections: { field: string; aiValue: unknown; correctedValue: unknown; note: string }[];
}

export interface ExtractInput {
  client: AnthropicClient;
  sourceUrl: string;
  markdown: string;
  screenshotPng: Uint8Array;
  priorContext: PriorContext;
}

export interface ExtractOutput {
  chart: CanonicalSizeChart;
  reportedConfidence: number;
  perFieldConfidence: Record<string, number>;
  whatISaw: string;
  rawText: string;
  usage: { inputTokens: number; outputTokens: number };
}

const SYSTEM_PROMPT = `You extract running-apparel brand size charts into a normalized JSON shape.
Inputs: a rendered markdown of the page and a screenshot.
Output a single JSON object with keys:
- chart: the size chart in the canonical shape (size_labels, measurements, size_availability, notes, gender_specific)
- overall_confidence: 0.0–1.0
- per_field_confidence (optional): map of size label → 0.0–1.0
- what_i_saw: one short paragraph for the human reviewer describing what's on the page

If the page lists separate men's/women's charts, return ONLY the chart matching the prior accepted version's gender_specific value (or men's if no prior). Note this in what_i_saw.

If you cannot confidently extract a chart, return overall_confidence < 0.3 and explain in what_i_saw.

Numbers are inches unless the page is clearly metric; convert cm to in if needed.
`;

function buildCorrectionsText(corrections: PriorContext["corrections"]): string {
  return corrections
    .map(
      (c) =>
        `- ${c.field}: was ${JSON.stringify(c.aiValue)}, corrected to ${JSON.stringify(c.correctedValue)} (${c.note})`
    )
    .join("\n");
}

function buildAssessmentsText(assessments: PriorContext["assessments"]): string {
  return assessments
    .map(
      (a) =>
        `- ${a.authorSlug}: ${Object.entries(a.ratings)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(", ")}`
    )
    .join("\n");
}

function buildUserText(input: ExtractInput): string {
  const prior = input.priorContext.lastAccepted;
  const corrections = buildCorrectionsText(input.priorContext.corrections);
  const assessmentSummary = buildAssessmentsText(input.priorContext.assessments);

  return `Source URL: ${input.sourceUrl}

Prior accepted chart (or "none"):
${prior ? JSON.stringify(prior, null, 2) : "none"}

Prior corrections for this brand:
${corrections || "(none)"}

Author brand-level assessments (calibration anchor):
${assessmentSummary || "(none)"}

Rendered markdown of the page:
---
${input.markdown}
---

Now extract per the system instructions.`;
}

export async function extractWithClaude(input: ExtractInput): Promise<ExtractOutput> {
  const userText = buildUserText(input);
  const resp = await input.client.extractStructured({
    model: MODEL_SONNET,
    systemPrompt: SYSTEM_PROMPT,
    userText,
    userImagePngBytes: input.screenshotPng,
    maxTokens: 4096,
  });
  const parsed = ClaudeResponseSchema.parse(resp.parsed);
  const chart = CanonicalSizeChartSchema.parse({
    source_url: input.sourceUrl,
    extracted_at: new Date().toISOString(),
    method: "claude",
    ...parsed.chart,
  });
  return {
    chart,
    reportedConfidence: parsed.overall_confidence,
    perFieldConfidence: parsed.per_field_confidence ?? {},
    whatISaw: parsed.what_i_saw,
    rawText: resp.rawText,
    usage: resp.usage,
  };
}
