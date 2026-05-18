import { Elysia, type AnyElysia } from "elysia";
import type { DB } from "../../infrastructure/db";
import { Layout, renderHtml } from "../layout";
import { AssessmentsGlobalPage } from "./assessments-global";

export function assessmentsGlobalRoute(args: Readonly<{ db: DB }>): AnyElysia {
  return new Elysia().get("/admin/assessments", async () => {
    const content = await AssessmentsGlobalPage({ db: args.db });
    return renderHtml(
      <Layout title="Assessments" currentPath="/admin/assessments">
        {content}
      </Layout>
    );
  });
}
