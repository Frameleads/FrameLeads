export type DecisionRolloutMode = 'DISABLED' | 'MANUAL' | 'SHADOW_AUTO';

/** Server-owned control. An absent or unrecognized value fails closed to manual analysis. */
export function getDecisionRolloutMode(value = process.env.DECISION_ENGINE_ROLLOUT_MODE): DecisionRolloutMode {
  return value === 'DISABLED' || value === 'SHADOW_AUTO' ? value : 'MANUAL';
}

export function canAutomaticallyTriage(mode = getDecisionRolloutMode()) {
  return mode === 'SHADOW_AUTO';
}

export function canManuallyAnalyze(mode = getDecisionRolloutMode()) {
  return mode !== 'DISABLED';
}
