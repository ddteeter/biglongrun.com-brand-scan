import { and, eq, gte, sql } from "drizzle-orm";
import { apiUsageLog } from "../../infrastructure/db/schema";
import type { DB } from "../../infrastructure/db";
import type { Provider } from "./tracker";

export interface BudgetConfig {
  firecrawlMonthlyPages: number;
  anthropicMonthlyUsd: number;
}

export type BudgetStatus = "ok" | "warn" | "exceeded";

export interface BudgetCheck {
  provider: Provider;
  status: BudgetStatus;
  used: number;
  budget: number;
  percentUsed: number;
}

export class CircuitBreaker {
  constructor(
    private readonly db: DB,
    private readonly cfg: BudgetConfig
  ) {}

  async check(provider: Provider): Promise<BudgetCheck> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const sinceIso = monthStart.toISOString();
    const [agg] = await this.db
      .select({
        pages: sql<number>`coalesce(sum(units_used), 0)`,
        cost: sql<number>`coalesce(sum(estimated_cost_usd), 0)`,
      })
      .from(apiUsageLog)
      .where(and(eq(apiUsageLog.provider, provider), gte(apiUsageLog.occurredAt, sinceIso)));
    const used = provider === "anthropic" ? (agg?.cost ?? 0) : (agg?.pages ?? 0);
    const budget =
      provider === "anthropic" ? this.cfg.anthropicMonthlyUsd : this.cfg.firecrawlMonthlyPages;
    const pct = budget === 0 ? 0 : used / budget;
    let status: BudgetStatus = "ok";
    if (pct >= 1) status = "exceeded";
    else if (pct >= 0.75) status = "warn";
    return { provider, status, used, budget, percentUsed: pct };
  }
}
