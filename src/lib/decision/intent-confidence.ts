/** Select the existing intent score for display. Never fall back to decision-wide,
 * risk, or policy confidence values. */
export function getDisplayedIntentConfidence<T extends { intentScore?: unknown }>(value: T | null | undefined): number | null {
  const score = value?.intentScore;
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100
    ? Math.round(score) : null;
}
