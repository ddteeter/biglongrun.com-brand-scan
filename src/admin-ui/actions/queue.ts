import { Elysia, type AnyElysia } from "elysia";
import type { DB } from "../../infrastructure/db";
import { VersionService } from "../../domain/extraction";

export function queueActions(args: Readonly<{ db: DB; authorSlug: string }>): AnyElysia {
  const versionService = new VersionService(args.db);
  return new Elysia()
    .post("/admin/queue/:id/approve", async ({ params, request, set }) => {
      const id = Number(params.id);
      const form = await request.formData();
      const editedJson = form.get("size_chart_json");

      let newChart: Record<string, unknown> | null = null;
      if (editedJson !== null) {
        const raw = editedJson instanceof File ? await editedJson.text() : editedJson;
        try {
          newChart = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          set.status = 400;
          return "Invalid JSON in size_chart_json";
        }
      }

      const result = await versionService.approve({
        versionId: id,
        acceptedBy: `human:${args.authorSlug}`,
        ...(newChart === null ? {} : { sizeChartOverride: newChart }),
      });

      if (!result) {
        set.status = 404;
        return "";
      }

      set.status = 302;
      set.headers.location = "/admin/queue";
      return "";
    })
    .post("/admin/queue/:id/reject", async ({ params, request, set }) => {
      const form = await request.formData();
      const rawReason = form.get("reason");
      const reason = (
        rawReason instanceof File ? await rawReason.text() : (rawReason ?? "")
      ).trim();
      if (!reason) {
        set.status = 400;
        return "Reason required";
      }
      await versionService.reject({ versionId: Number(params.id), reason });
      set.status = 302;
      set.headers.location = "/admin/queue";
      return "";
    })
    .post("/admin/queue/:id/reprocess", async ({ params, set }) => {
      // Phase 1 stub: real reprocess-from-stored-artifacts is a future task.
      const version = await versionService.findById(Number(params.id));
      if (!version) {
        set.status = 404;
        return "";
      }
      set.status = 302;
      set.headers.location = "/admin/queue";
      return "";
    });
}
