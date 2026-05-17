import { Elysia, type AnyElysia } from "elysia";
import { BrandService } from "../../domain/brands";
import type { DB } from "../../infrastructure/db";

export function brandActions(args: { db: DB }): AnyElysia {
  const repo = new BrandService(args.db);
  return new Elysia().post("/admin/brands/create", async ({ request }) => {
    const form = await request.formData();
    const rawName = form.get("name");
    const rawUrl = form.get("primaryUrl");
    const created = await repo.create({
      name: typeof rawName === "string" ? rawName : "",
      primaryUrl: typeof rawUrl === "string" ? rawUrl : "",
    });
    return new Response(null, {
      status: 302,
      headers: { location: `/admin/brands/${created.slug}` },
    });
  });
}
