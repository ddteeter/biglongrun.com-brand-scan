import { and, eq, lte } from "drizzle-orm";
import { jobs } from "../db/schema";
import type { DB } from "../db";

export interface EnqueueInput {
  jobType: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  scheduledFor?: Date;
  maxAttempts?: number;
}

export interface ClaimOptions {
  heartbeatIntervalSecs: number;
}

const BACKOFF_BASE_SECS = 60;
const BACKOFF_CAP_SECS = 3600;

function nextBackoffSeconds(attempts: number): number {
  const base = Math.min(2 ** attempts * BACKOFF_BASE_SECS, BACKOFF_CAP_SECS);
  // Use crypto for jitter to satisfy security linting rules
  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  const randVal = rand[0] ?? 0;
  const jitter = (randVal % 31) - 15;
  return base + jitter;
}

export class Queue {
  constructor(private readonly db: DB) {}

  async enqueue(input: EnqueueInput): Promise<number> {
    const existing = await this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.dedupeKey, input.dedupeKey))
      .limit(1);
    if (existing.length > 0) {
      const row = existing[0];
      if (!row) throw new Error("Unexpected empty row");
      return row.id;
    }
    const rows = await this.db
      .insert(jobs)
      .values({
        jobType: input.jobType,
        payloadJson: input.payload,
        dedupeKey: input.dedupeKey,
        status: "pending",
        scheduledFor: (input.scheduledFor ?? new Date()).toISOString(),
        maxAttempts: input.maxAttempts ?? 3,
      })
      .returning({ id: jobs.id });
    const inserted = rows[0];
    if (!inserted) throw new Error("Insert returned no rows");
    return inserted.id;
  }

  async findById(id: number) {
    const rows = await this.db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async claimNext(opts: ClaimOptions) {
    return this.db.transaction(async (tx) => {
      const now = new Date().toISOString();
      const candidates = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, "pending"), lte(jobs.scheduledFor, now)))
        .orderBy(jobs.scheduledFor)
        .limit(1);
      const candidate = candidates[0];
      if (!candidate) return null;
      const updated = await tx
        .update(jobs)
        .set({
          status: "running",
          pickedAt: now,
          heartbeatAt: now,
          heartbeatIntervalSecs: opts.heartbeatIntervalSecs,
        })
        .where(eq(jobs.id, candidate.id))
        .returning();
      return updated[0] ?? null;
    });
  }

  async heartbeat(jobId: number): Promise<void> {
    await this.db
      .update(jobs)
      .set({ heartbeatAt: new Date().toISOString() })
      .where(eq(jobs.id, jobId));
  }

  async finish(jobId: number): Promise<void> {
    await this.db
      .update(jobs)
      .set({
        status: "succeeded",
        finishedAt: new Date().toISOString(),
        errorJson: null,
      })
      .where(eq(jobs.id, jobId));
  }

  async fail(jobId: number, error: Error): Promise<void> {
    const job = await this.findById(jobId);
    if (!job) return;
    const attempts = job.attempts + 1;
    const isDead = attempts >= job.maxAttempts;
    const nextScheduledFor = isDead
      ? job.scheduledFor
      : new Date(Date.now() + nextBackoffSeconds(attempts) * 1000).toISOString();
    await this.db
      .update(jobs)
      .set({
        status: isDead ? "failed_dead" : "pending",
        attempts,
        pickedAt: null,
        heartbeatAt: null,
        scheduledFor: nextScheduledFor,
        errorJson: error.stack
          ? { message: error.message, stack: error.stack }
          : { message: error.message },
        finishedAt: isDead ? new Date().toISOString() : null,
      })
      .where(eq(jobs.id, jobId));
  }
}
