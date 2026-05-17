export { CanonicalSizeChartSchema, parseCanonical, type CanonicalSizeChart } from "./canonical";
export { validateStructural, type ValidationResult } from "./validators";
export { parseDeterministic } from "./parser-deterministic";
export {
  extractWithClaude,
  type PriorContext,
  type ExtractInput,
  type ExtractOutput,
} from "./extractor-claude";
export { compositeConfidence, type ConfidenceInputs, type ConfidenceResult } from "./confidence";
export { cohortOutlierFactor, type CohortSummary } from "./outlier";
export { assemblePriorContext } from "./prior-context";
export {
  runExtraction,
  type PipelineDeps,
  type PipelineInput,
  type PipelineOutcome,
} from "./pipeline";
