import { Cron } from "croner";

export interface CronSpec {
  name: string;
  cron: string;
  enqueue: () => Promise<void>;
}

export class Scheduler {
  private readonly specs = new Map<string, CronSpec>();
  private readonly active = new Map<string, Cron>();

  register(spec: CronSpec): void {
    if (this.specs.has(spec.name)) {
      throw new Error(`Cron already registered: ${spec.name}`);
    }
    this.specs.set(spec.name, spec);
  }

  list(): CronSpec[] {
    return [...this.specs.values()];
  }

  start(): void {
    for (const spec of this.specs.values()) {
      const cron = new Cron(spec.cron, { paused: false, protect: true }, () => {
        spec.enqueue().catch(() => {
          // best-effort enqueue on cron fire; errors are logged separately
        });
      });
      this.active.set(spec.name, cron);
    }
  }

  stop(): void {
    for (const c of this.active.values()) c.stop();
    this.active.clear();
  }

  async fireNow(name: string): Promise<void> {
    const spec = this.specs.get(name);
    if (!spec) throw new Error(`Unknown cron: ${name}`);
    await spec.enqueue();
  }
}
