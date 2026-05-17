import type { Queue } from "./queue";
import { getHandler } from "./handlers";

export interface RunnerOptions {
  queue: Queue;
  pollIntervalMs: number;
  heartbeatIntervalSecs: number;
}

export class QueueRunner {
  private readonly target = new EventTarget();
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(private readonly opts: RunnerOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.target.addEventListener("wake", () => {
      this.tick().catch(() => {
        // swallow tick errors; job-level errors are handled inside tick
      });
    });
    this.pollTimer = setInterval(() => {
      this.tick().catch(() => {
        // swallow tick errors; job-level errors are handled inside tick
      });
    }, this.opts.pollIntervalMs);
    this.tick().catch(() => {
      // swallow tick errors; job-level errors are handled inside tick
    });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  wake(): void {
    this.target.dispatchEvent(new Event("wake"));
  }

  private isRunning(): boolean {
    return this.running;
  }

  private async tick(): Promise<void> {
    if (!this.isRunning() || this.busy) return;
    this.busy = true;
    try {
      while (this.isRunning()) {
        const claimed = await this.opts.queue.claimNext({
          heartbeatIntervalSecs: this.opts.heartbeatIntervalSecs,
        });
        if (!claimed) break;
        await this.execute(claimed);
      }
    } finally {
      this.busy = false;
    }
  }

  private async execute(job: {
    id: number;
    jobType: string;
    payloadJson: Record<string, unknown>;
  }): Promise<void> {
    const handler = getHandler(job.jobType);
    if (!handler) {
      await this.opts.queue.fail(job.id, new Error(`No handler for job type: ${job.jobType}`));
      return;
    }
    const heartbeatTimer = setInterval(
      () => {
        this.opts.queue.heartbeat(job.id).catch(() => {
          // best-effort heartbeat; ignore errors
        });
      },
      (this.opts.heartbeatIntervalSecs * 1000) / 2
    );
    try {
      await handler(job.payloadJson, {
        jobId: job.id,
        heartbeat: () => this.opts.queue.heartbeat(job.id),
      });
      await this.opts.queue.finish(job.id);
    } catch (error) {
      await this.opts.queue.fail(job.id, error instanceof Error ? error : new Error(String(error)));
    } finally {
      clearInterval(heartbeatTimer);
    }
  }
}
