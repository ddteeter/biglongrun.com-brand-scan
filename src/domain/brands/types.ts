import { z } from "zod";

export const NewBrandInputSchema = z.object({
  name: z.string().min(1).max(120),
  primaryUrl: z.url(),
  categoryTag: z.string().min(1).max(40).default("running"),
});

export type NewBrandInput = z.infer<typeof NewBrandInputSchema>;

export const NewBrandSourceInputSchema = z.object({
  brandId: z.number().int().positive(),
  url: z.url(),
  sourceType: z.enum(["size_chart", "catalog_root", "shopify_feed"]),
});

export type NewBrandSourceInput = z.infer<typeof NewBrandSourceInputSchema>;
