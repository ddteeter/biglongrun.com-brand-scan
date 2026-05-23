import { z } from "zod";

export const NewSuggestionInputSchema = z.object({
  suggestedBrandName: z.string().min(1).max(200),
  suggestedSlug: z.string().min(1).max(200),
  suggestedUrl: z.url().nullable().optional(),
  sourceSubreddit: z.string().min(1).max(100),
  sourcePostUrl: z.url(),
  sourcePostTitle: z.string().min(1),
  sourceContext: z.string().optional(),
  plusSizePriority: z.boolean().default(false),
});

export type NewSuggestionInput = z.infer<typeof NewSuggestionInputSchema>;

export const AcceptSuggestionInputSchema = z.object({
  id: z.number().int().positive(),
  primaryUrl: z.url(),
});

export type AcceptSuggestionInput = z.infer<typeof AcceptSuggestionInputSchema>;

export const RejectSuggestionInputSchema = z.object({
  id: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});

export type RejectSuggestionInput = z.infer<typeof RejectSuggestionInputSchema>;
