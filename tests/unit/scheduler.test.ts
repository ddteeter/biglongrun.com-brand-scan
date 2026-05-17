import { describe, test, expect } from "bun:test";
import { Scheduler, type CronSpec } from "../../src/infrastructure/queue/scheduler";

describe("Scheduler", () => {
  test("registerCron records each spec", () => {
    const sched = new Scheduler();
    const specs: CronSpec[] = [
      { name: "sweep", cron: "0 3 1 * *", enqueue: () => Promise.resolve() },
      { name: "stuck", cron: "* * * * *", enqueue: () => Promise.resolve() },
    ];
    for (const s of specs) sched.register(s);
    expect(
      sched
        .list()
        .map((s) => s.name)
        .toSorted((a, b) => a.localeCompare(b))
    ).toEqual(["stuck", "sweep"]);
  });

  test("fireNow runs the enqueue fn synchronously for tests", async () => {
    const sched = new Scheduler();
    let called = false;
    sched.register({
      name: "x",
      cron: "* * * * *",
      enqueue: () => {
        called = true;
        return Promise.resolve();
      },
    });
    await sched.fireNow("x");
    expect(called).toBe(true);
  });

  test("fireNow throws on unknown name", async () => {
    const sched = new Scheduler();
    let threw = false;
    try {
      await sched.fireNow("nope");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
