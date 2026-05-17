import { apiUsageLog } from "../../infrastructure/db/schema";
import type { DB } from "../../infrastructure/db";

export type Provider = "firecrawl" | "anthropic" | "pushover";

export interface RecordUsageInput {
  provider: Provider;
  runId?: number;
  unitsUsed: number;
  unitsKind: string;
  estimatedCostUsd: number;
}

export class UsageTracker {
  constructor(private readonly db: DB) {}

  async record(input: RecordUsageInput): Promise<void> {
    const optional: { runId?: number } = {};
    if (input.runId !== undefined) optional.runId = input.runId;
    await this.db.insert(apiUsageLog).values({
      provider: input.provider,
      ...optional,
      unitsUsed: input.unitsUsed,
      unitsKind: input.unitsKind,
      estimatedCostUsd: input.estimatedCostUsd,
    });
  }
}
