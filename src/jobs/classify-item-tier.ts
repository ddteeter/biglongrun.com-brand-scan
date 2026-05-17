import { z } from "zod";
import { and, eq, isNotNull } from "drizzle-orm";
import type { JobHandler } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import { brandItems, brandItemChanges } from "../infrastructure/db/schema";
import { classifyByPricePercentile, refineWithAi } from "../domain/catalog";
import type { AnthropicClient } from "../infrastructure/external/anthropic";
import type { FirecrawlClient } from "../infrastructure/external/firecrawl";

const PayloadSchema = z.object({ brandId: z.number().int().positive() });

export interface MakeArgs {
  db: DB;
  firecrawl: FirecrawlClient;
  anthropic: AnthropicClient;
  recordUsage: (input: {
    provider: "anthropic" | "firecrawl";
    unitsUsed: number;
    unitsKind: string;
    estimatedCostUsd: number;
  }) => Promise<void>;
}

export function makeClassifyItemTierHandler(args: MakeArgs): JobHandler {
  return async (rawPayload) => {
    const { brandId } = PayloadSchema.parse(rawPayload);
    const items = await args.db
      .select()
      .from(brandItems)
      .where(
        and(
          eq(brandItems.brandId, brandId),
          eq(brandItems.isDiscontinued, false),
          isNotNull(brandItems.basePriceUsd)
        )
      );

    const cohortPrices = items.map((i) => i.basePriceUsd).filter((p): p is number => p !== null);

    for (const item of items) {
      // Skip already-human-classified items.
      if (item.tierInferredBy?.startsWith("human:")) continue;

      const heuristic = classifyByPricePercentile(item.basePriceUsd, cohortPrices);

      let newTier = heuristic.tier;
      let newRationale = heuristic.reason;
      let newInferredBy = "price_percentile";

      // AI refinement gate — enabled only when ENABLE_AI_TIER_REFINE=1.
      // Not part of the default phase-2 baseline; kept here so the path is
      // importable and testable without incurring Anthropic spend by default.
      if (process.env.ENABLE_AI_TIER_REFINE === "1" && item.sourceUrl) {
        const pageResult = await args.firecrawl.render(item.sourceUrl);
        const aiResult = await refineWithAi({
          client: args.anthropic,
          itemName: item.name,
          itemMarkdown: pageResult.markdown,
          basePriceUsd: item.basePriceUsd,
          heuristic,
        });
        await args.recordUsage({
          provider: "anthropic",
          unitsUsed: aiResult.usage.inputTokens + aiResult.usage.outputTokens,
          unitsKind: "tokens",
          estimatedCostUsd: 0,
        });
        newTier = aiResult.tier;
        newRationale = aiResult.rationale;
        newInferredBy = "ai";
      }

      if (item.tierClassification === newTier && item.tierInferredBy === newInferredBy) continue;

      await args.db
        .update(brandItems)
        .set({
          tierClassification: newTier,
          tierInferredBy: newInferredBy,
          tierRationale: newRationale,
        })
        .where(eq(brandItems.id, item.id));

      await args.db.insert(brandItemChanges).values({
        itemId: item.id,
        changeType: "tier_reclassified",
        beforeJson: {
          tier: item.tierClassification,
          inferredBy: item.tierInferredBy,
          rationale: item.tierRationale,
        },
        afterJson: {
          tier: newTier,
          inferredBy: newInferredBy,
          rationale: newRationale,
        },
      });
    }
  };
}
