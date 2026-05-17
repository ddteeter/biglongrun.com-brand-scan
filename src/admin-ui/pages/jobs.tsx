import { Layout, renderHtml } from "../layout";
import { Elysia, type AnyElysia } from "elysia";
import { desc } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { jobs } from "../../infrastructure/db/schema";

export function jobsRoute(args: Readonly<{ db: DB }>): AnyElysia {
  return new Elysia().get("/admin/jobs", async () => {
    const recent = await args.db.select().from(jobs).orderBy(desc(jobs.scheduledFor)).limit(100);
    return renderHtml(
      <Layout title="Jobs" currentPath="/admin/jobs">
        <h1>Jobs</h1>
        <table role="grid">
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Scheduled</th>
              <th>Picked</th>
              <th>Heartbeat</th>
              <th>Finished</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((j) => (
              <tr>
                <td>{String(j.id)}</td>
                <td>{j.jobType}</td>
                <td>{j.status}</td>
                <td>
                  {String(j.attempts)}/{String(j.maxAttempts)}
                </td>
                <td>{j.scheduledFor}</td>
                <td>{j.pickedAt ?? "—"}</td>
                <td>{j.heartbeatAt ?? "—"}</td>
                <td>{j.finishedAt ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Layout>
    );
  });
}
