import { Elysia, type AnyElysia } from "elysia";
import { BrandSourceService } from "../../domain/brands";
import type { DB } from "../../infrastructure/db";
import type { Queue } from "../../infrastructure/queue";

export function sourceActions(args: { db: DB; queue: Queue }): AnyElysia {
  const repo = new BrandSourceService(args.db);
  return new Elysia()
    .post("/admin/brand-sources/create", async ({ request }) => {
      const form = await request.formData();
      const brandId = Number(form.get("brandId"));
      const rawUrl = form.get("url");
      const rawType = form.get("sourceType");
      await repo.create({
        brandId,
        url: typeof rawUrl === "string" ? rawUrl : "",
        sourceType: typeof rawType === "string" ? rawType : "size_chart",
      });
      return new Response(null, {
        status: 302,
        headers: { location: `/admin/brands?refresh=1` },
      });
    })
    .post("/admin/brand-sources/:id/delete", async ({ params, request }) => {
      await repo.delete(Number(params.id));
      const referer = request.headers.get("referer") ?? "/admin/brands";
      return new Response(null, { status: 302, headers: { location: referer } });
    })
    .post("/admin/brand-sources/:id/extract-now", async ({ params, request }) => {
      await args.queue.enqueue({
        jobType: "extract-brand-source",
        payload: { brandSourceId: Number(params.id) },
        dedupeKey: `extract-brand-source:${params.id}:manual:${String(Date.now())}`,
      });
      const referer = request.headers.get("referer") ?? "/admin/brands";
      return new Response(null, { status: 302, headers: { location: referer } });
    });
}
