import { Elysia, type AnyElysia } from "elysia";
import type { DB } from "../../infrastructure/db";
import { Layout, renderHtml } from "../layout";
import { AssessmentEditPage } from "./assessment-edit";

export function assessmentEditRoute(args: Readonly<{ db: DB }>): AnyElysia {
  return new Elysia().get("/admin/assessments/:id/edit", async ({ params, set }) => {
    const id = Number(params.id);
    if (!Number.isFinite(id) || id <= 0) {
      set.status = 404;
      return new Response("Not found", { status: 404 });
    }
    const content = await AssessmentEditPage({ db: args.db, assessmentId: id });
    return renderHtml(
      <Layout title="Edit Assessment" currentPath="/admin/assessments">
        {content}
      </Layout>
    );
  });
}
