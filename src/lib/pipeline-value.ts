export const DEFAULT_PIPELINE_VALUE = 5_000;

export function resolvePipelineValue(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.round(numericValue)
    : DEFAULT_PIPELINE_VALUE;
}
