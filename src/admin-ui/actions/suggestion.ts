import { Elysia, type AnyElysia } from "elysia";
import type { DB } from "../../infrastructure/db";
import { BrandSuggestionService } from "../../domain/suggestions";

/** Safely extract a string value from a form field (handles File entries). */
function formString(form: FormData, key: string): string {
  const v = form.get(key);
  if (v === null) return "";
  if (v instanceof File) return "";
  return v;
}

export function suggestionActions(args: Readonly<{ db: DB }>): AnyElysia {
  const service = new BrandSuggestionService(args.db);
  return new Elysia()
    .post("/admin/suggestions/:id/accept", async ({ params, request, set }) => {
      const id = Number(params.id);
      const form = await request.formData();
      const primaryUrl = formString(form, "primaryUrl");
      try {
        const result = await service.accept({ id, primaryUrl });
        set.status = 302;
        set.headers.location = `/admin/brands/${result.brandSlug}`;
        return "";
      } catch (error) {
        set.status = 400;
        return `Invalid: ${(error as Error).message}`;
      }
    })
    .post("/admin/suggestions/:id/reject", async ({ params, request, set }) => {
      const id = Number(params.id);
      const form = await request.formData();
      const reason = formString(form, "reason");
      try {
        await service.reject({ id, reason });
        set.status = 302;
        set.headers.location = "/admin/suggestions";
        return "";
      } catch (error) {
        set.status = 400;
        return `Invalid: ${(error as Error).message}`;
      }
    });
}
