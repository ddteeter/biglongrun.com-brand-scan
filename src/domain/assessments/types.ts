import { z } from "zod";

export const AssessmentRatingsSchema = z.object({
  size_options: z.number().min(0).max(10),
  tier_equity: z.number().min(0).max(10),
  pricing_equity: z.number().min(0).max(10),
  fit_label_honesty: z.number().min(0).max(10),
  overall_inclusivity: z.number().min(0).max(10),
});

export type AssessmentRatings = z.infer<typeof AssessmentRatingsSchema>;

export const NewAssessmentInputSchema = z.object({
  brandId: z.number().int().positive(),
  authorSlug: z.string().min(1).max(40),
  ratings: AssessmentRatingsSchema,
  proseMarkdown: z.string().default(""),
  origin: z.enum(["native", "backfilled_from_blog_review"]).default("native"),
  sourceReviewUrl: z.url().nullable().optional(),
  assessmentDate: z.string().optional(),
});

export type NewAssessmentInput = z.infer<typeof NewAssessmentInputSchema>;

export const UpdateAssessmentInputSchema = z.object({
  id: z.number().int().positive(),
  ratings: AssessmentRatingsSchema.optional(),
  proseMarkdown: z.string().optional(),
});

export type UpdateAssessmentInput = z.infer<typeof UpdateAssessmentInputSchema>;
