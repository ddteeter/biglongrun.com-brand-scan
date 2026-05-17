import { z } from "zod";

const RangeIn = z.tuple([z.number(), z.number()]);

const Measurement = z.object({
  chest_in: RangeIn,
  waist_in: RangeIn,
  hip_in: RangeIn,
});

const SizeAvailability = z.object({
  category: z.string(),
  available_sizes: z.array(z.string()),
});

export const CanonicalSizeChartSchema = z.object({
  source_url: z.url(),
  extracted_at: z.string(),
  method: z.enum(["deterministic", "claude"]),
  size_labels: z.array(z.string()),
  measurements: z.record(z.string(), Measurement),
  size_availability: z.array(SizeAvailability),
  notes: z.string().default(""),
  gender_specific: z.union([z.literal(false), z.enum(["men", "women", "unisex"])]),
});

export type CanonicalSizeChart = z.infer<typeof CanonicalSizeChartSchema>;

export function parseCanonical(raw: unknown): CanonicalSizeChart {
  return CanonicalSizeChartSchema.parse(raw);
}
