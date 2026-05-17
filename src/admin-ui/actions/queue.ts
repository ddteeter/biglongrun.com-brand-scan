import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brands, brandSizeChartVersions } from "../../infrastructure/db/schema";

export function queueActions(args: Readonly<{ db: DB; authorSlug: string }>): Elysia {
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

      const rows = await args.db
        .select()
        .from(brandSizeChartVersions)
        .where(eq(brandSizeChartVersions.id, id))
        .limit(1);
      const version = rows[0];
      if (!version) {
        set.status = 404;
        return "";
      }

      // Supersede any prior accepted version for this brand
      await args.db
        .update(brandSizeChartVersions)
        .set({ status: "superseded" })
        .where(
          and(
            eq(brandSizeChartVersions.brandId, version.brandId),
            eq(brandSizeChartVersions.status, "accepted")
          )
        );

      // Mark this version accepted, with optional edits
      await args.db
        .update(brandSizeChartVersions)
        .set({
          status: "accepted",
          sizeChartJson: newChart ?? version.sizeChartJson,
          acceptedAt: new Date().toISOString(),
          acceptedBy: `human:${args.authorSlug}`,
        })
        .where(eq(brandSizeChartVersions.id, id));

      // Point the brand to this version
      await args.db
        .update(brands)
        .set({ currentSizeChartVersionId: id })
        .where(eq(brands.id, version.brandId));

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
      await args.db
        .update(brandSizeChartVersions)
        .set({
          status: "rejected",
          rejectionReason: reason,
        })
        .where(eq(brandSizeChartVersions.id, Number(params.id)));
      set.status = 302;
      set.headers.location = "/admin/queue";
      return "";
    })
    .post("/admin/queue/:id/reprocess", async ({ params, set }) => {
      // Phase 1 stub: real reprocess-from-stored-artifacts is a future task.
      const rows = await args.db
        .select()
        .from(brandSizeChartVersions)
        .where(eq(brandSizeChartVersions.id, Number(params.id)))
        .limit(1);
      if (!rows[0]) {
        set.status = 404;
        return "";
      }
      set.status = 302;
      set.headers.location = "/admin/queue";
      return "";
    });
}
