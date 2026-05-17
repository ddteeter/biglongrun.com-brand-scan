import { and, eq, isNotNull } from "drizzle-orm";
import { jobs } from "../db/schema";
import type { DB } from "../db";

export interface DetectOptions {
  db: DB;
  now: () => Date;
}

export interface DetectResult {
  reset: number[];
  killed: number[];
}

export async function detectStuckJobs(opts: DetectOptions): Promise<DetectResult> {
  const result: DetectResult = { reset: [], killed: [] };
  const nowMs = opts.now().getTime();

  const stuck = await opts.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "running"), isNotNull(jobs.heartbeatAt)));

  for (const job of stuck) {
    const interval = job.heartbeatIntervalSecs ?? 30;
    const lastBeat = job.heartbeatAt ? new Date(job.heartbeatAt).getTime() : 0;
    if (nowMs - lastBeat <= interval * 3 * 1000) continue;

    const attempts = job.attempts + 1;
    const isDead = attempts >= job.maxAttempts;
    await opts.db
      .update(jobs)
      .set({
        status: isDead ? "failed_dead" : "pending",
        attempts,
        pickedAt: null,
        heartbeatAt: null,
        errorJson: { message: "heartbeat timeout (stuck job)" },
        finishedAt: isDead ? new Date(nowMs).toISOString() : null,
      })
      .where(eq(jobs.id, job.id));
    if (isDead) result.killed.push(job.id);
    else result.reset.push(job.id);
  }

  return result;
}
