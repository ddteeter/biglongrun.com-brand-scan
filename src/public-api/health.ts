import { Elysia, type AnyElysia } from "elysia";
import { eq, count } from "drizzle-orm";
import type { DB } from "../infrastructure/db";
import { jobs } from "../infrastructure/db/schema";

export function healthRoute(args: { db: DB; bootedAt: Date }): AnyElysia {
  return new Elysia().get("/api/v1/health", async () => {
    let dbOk: boolean;
    let pendingCount: number;
    try {
      const [row] = await args.db
        .select({ c: count() })
        .from(jobs)
        .where(eq(jobs.status, "pending"));
      dbOk = true;
      pendingCount = row?.c ?? 0;
    } catch {
      dbOk = false;
      pendingCount = 0;
    }
    return {
      ok: dbOk,
      db: dbOk,
      pendingJobs: pendingCount,
      uptimeSecs: Math.floor((Date.now() - args.bootedAt.getTime()) / 1000),
    };
  });
}
