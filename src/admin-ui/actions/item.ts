import { Elysia, type AnyElysia } from "elysia";
import { eq } from "drizzle-orm";
import type { DB } from "../../infrastructure/db";
import { brandItems, brandItemChanges } from "../../infrastructure/db/schema";

const VALID_TIERS = new Set(["flagship", "mid", "basic", "unclassified"]);

export function itemActions(args: { db: DB; authorSlug: string }): AnyElysia {
  return new Elysia().post("/admin/items/:id/set-tier", async ({ params, request, set }) => {
    const form = await request.formData();
    const rawTier = form.get("tier");
    const tier = rawTier instanceof File ? await rawTier.text() : (rawTier ?? "");
    if (!VALID_TIERS.has(tier)) {
      set.status = 400;
      return "invalid tier";
    }
    const itemId = Number(params.id);
    const [before] = await args.db
      .select()
      .from(brandItems)
      .where(eq(brandItems.id, itemId))
      .limit(1);
    if (!before) {
      set.status = 404;
      return "item not found";
    }

    const rawRationale = form.get("rationale");
    const rationale =
      rawRationale instanceof File ? await rawRationale.text() : (rawRationale ?? "human override");
    const inferredBy = `human:${args.authorSlug}`;

    await args.db
      .update(brandItems)
      .set({
        tierClassification: tier as typeof brandItems.$inferInsert.tierClassification,
        tierInferredBy: inferredBy,
        tierRationale: rationale,
      })
      .where(eq(brandItems.id, itemId));

    await args.db.insert(brandItemChanges).values({
      itemId,
      changeType: "tier_reclassified",
      beforeJson: {
        tier: before.tierClassification,
        inferredBy: before.tierInferredBy,
        rationale: before.tierRationale,
      },
      afterJson: {
        tier,
        inferredBy,
        rationale,
      },
    });

    set.status = 302;
    set.headers.location = request.headers.get("referer") ?? "/admin";
    return "";
  });
}
