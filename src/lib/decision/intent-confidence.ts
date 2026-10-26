/** Select the existing intent score for display. Never fall back to decision-wide,
 * risk, or policy confidence values. */
export function getDisplayedIntentConfidence<T extends { intentScore?: unknown }>(value: T | null | undefined): number | null {
  const score = value?.intentScore;
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100
    ? Math.round(score) : null;
}

/** Only a validated, persisted interest score from the actual reply analysis may
 * populate the prospect-interest widget. Model confidence is NOT buyer interest.
 * Legacy decisions without this field intentionally display "Not assessed". */
export function getDecisionProspectInterestScore(decision: unknown): number | null {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return null;
  const row = decision as { source?: unknown; trace?: unknown };
  if (row.source !== 'GEMINI' && row.source !== 'ANTHROPIC') return null;
  if (!row.trace || typeof row.trace !== 'object' || Array.isArray(row.trace)) return null;
  const output = (row.trace as { intentOutput?: unknown }).intentOutput;
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  return getDisplayedIntentConfidence({ intentScore: (output as { prospectInterestScore?: unknown }).prospectInterestScore });
}
