import { z } from "zod";

export const PerSizeDataSchema = z.record(
  z.string(),
  z.object({
    available: z.boolean(),
    price: z.number().optional(),
    colors: z.array(z.string()).optional(),
  })
);
export type PerSizeData = z.infer<typeof PerSizeDataSchema>;

export const ItemDraftSchema = z.object({
  brandId: z.number().int().positive(),
  externalId: z.string().nullable().optional(),
  sourceUrl: z.url(),
  name: z.string().min(1),
  category: z.string().min(1),
  basePriceUsd: z.number().nullable().optional(),
  perSizeData: PerSizeDataSchema.default({}),
});
export type ItemDraft = z.infer<typeof ItemDraftSchema>;
