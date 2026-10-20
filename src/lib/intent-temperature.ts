export type IntentTemperature = 'HOT' | 'WARM' | 'COLD';

/** Prospect interest score only. Decision confidence is a separate measure. */
export function intentTemperature(score: number | null | undefined): IntentTemperature | null {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) return null;
  if (score >= 80) return 'HOT';
  if (score >= 60) return 'WARM';
  return 'COLD';
}

/** Preserve valid legacy categorical assessments when that ingestion has no numeric score. */
export function resolveIntentTemperature(score: number | null | undefined, category?: string | null): IntentTemperature | null {
  if (score == null) return category === 'HOT' || category === 'WARM' || category === 'COLD' ? category : null;
  return intentTemperature(score);
}

export function formatIntentTemperature(score: number | null | undefined, category?: string | null): string {
  const value = resolveIntentTemperature(score, category);
  if (value === 'HOT') return '🔥 HOT';
  if (value === 'WARM') return '☀️ WARM';
  if (value === 'COLD') return '❄️ COLD';
  return 'UNASSESSED';
}

export function isHighPriorityIntent(score: number | null | undefined, category?: string | null): boolean {
  return resolveIntentTemperature(score, category) === 'HOT';
}
