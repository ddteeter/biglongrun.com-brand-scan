import type { JobHandler, Queue } from "../infrastructure/queue";
import { MONITORED_SUBREDDITS } from "../domain/suggestions";

export function makeSweepRedditSuggestionsHandler(args: { queue: Queue }): JobHandler {
  return async () => {
    const day = new Date().toISOString().slice(0, 10);
    for (const subreddit of MONITORED_SUBREDDITS) {
      await args.queue.enqueue({
        jobType: "ingest-subreddit",
        payload: { subreddit },
        dedupeKey: `ingest-subreddit:${subreddit}:${day}`,
      });
    }
  };
}
