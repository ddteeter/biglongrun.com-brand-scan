import type { JobHandler } from "../infrastructure/queue";
import type { DB } from "../infrastructure/db";
import { detectStuckJobs } from "../infrastructure/queue/stuck-detector";
import type { PushoverClient } from "../infrastructure/external/pushover";

export function makeDetectStuckJobsHandler(args: { db: DB; pushover: PushoverClient }): JobHandler {
  return async () => {
    const result = await detectStuckJobs({ db: args.db, now: () => new Date() });
    if (result.killed.length > 0) {
      await args.pushover.notify({
        title: "brand-scan: jobs dead-lettered",
        message: `Jobs hit max attempts after stale heartbeat: ${result.killed.join(", ")}`,
      });
    }
  };
}
