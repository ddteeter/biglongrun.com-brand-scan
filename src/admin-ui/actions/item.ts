import { Elysia, type AnyElysia } from "elysia";
import type { BrandItemService } from "../../domain/catalog";

const VALID_TIERS = new Set(["flagship", "mid", "basic", "unclassified"]);

export function itemActions(args: {
  itemService: BrandItemService;
  authorSlug: string;
}): AnyElysia {
  return new Elysia().post("/admin/items/:id/set-tier", async ({ params, request, set }) => {
    const form = await request.formData();
    const rawTier = form.get("tier");
    const tier = rawTier instanceof File ? await rawTier.text() : (rawTier ?? "");
    if (!VALID_TIERS.has(tier)) {
      set.status = 400;
      return "invalid tier";
    }

    const rawRationale = form.get("rationale");
    const rationale =
      rawRationale instanceof File ? await rawRationale.text() : (rawRationale ?? "human override");

    const itemId = Number(params.id);
    const result = await args.itemService.setTierByHuman({
      itemId,
      tier: tier as "flagship" | "mid" | "basic" | "unclassified",
      authorSlug: args.authorSlug,
      rationale,
    });

    if (result === "not_found") {
      set.status = 404;
      return "item not found";
    }

    set.status = 302;
    set.headers.location = request.headers.get("referer") ?? "/admin";
    return "";
  });
}
