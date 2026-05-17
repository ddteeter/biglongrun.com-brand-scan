import { desc, eq } from "drizzle-orm";
import type { DB } from "../../../infrastructure/db";
import { runs, jobs } from "../../../infrastructure/db/schema";

// Phase 1: runs are keyed only by job; no denormalized brand link exists yet.
// Show recent runs globally; brand-scoped runs come with a future schema tweak.
export async function RunsTab(_args: Readonly<{ db: DB; brandId: number }>): Promise<string> {
  const rows = await _args.db
    .select({
      id: runs.id,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      status: runs.status,
      jobType: jobs.jobType,
    })
    .from(runs)
    .innerJoin(jobs, eq(runs.jobId, jobs.id))
    .orderBy(desc(runs.startedAt))
    .limit(20);
  return (
    <div>
      <h3>Recent runs (global; brand-scoped view coming with phase 2)</h3>
      <table role="grid">
        <thead>
          <tr>
            <th>Run</th>
            <th>Type</th>
            <th>Status</th>
            <th>Started</th>
            <th>Finished</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td>{String(r.id)}</td>
              <td>{r.jobType}</td>
              <td>{r.status}</td>
              <td>{r.startedAt}</td>
              <td>{r.finishedAt ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
