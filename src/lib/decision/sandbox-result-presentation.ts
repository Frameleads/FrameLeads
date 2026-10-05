import { formatConstitutionCondition } from '../sales-constitution-presentation';

export type PresentationTone = 'positive' | 'warning' | 'danger' | 'neutral';

export type ConstitutionResult = {
  decision: string;
  effect: string | null;
  winningRule: unknown;
  winnerReason: string | null;
  matchedRuleIds: string[];
  unresolvedRuleIds: string[];
};

export type AutomationResult = {
  resolvedMode: string;
  state: string;
  reasons: string[];
  productionExecutionEnabled: boolean;
};

export type RevenuePriorityResult = {
  status: string;
  score: number | null;
  band: string | null;
  confidence: string;
  reasons: string[];
  simulatedBand: string | null;
};

export type ResponseSlaResult = {
  applicable: boolean;
  reason: string;
  durationMinutes: number | null;
  hypotheticalDueAt: string | null;
  sourceRiskBand: string | null;
};

export function formatSandboxLabel(value: string | null | undefined) {
  return value ? value.toLowerCase().split('_').filter(Boolean)
    .map(word => word[0].toUpperCase() + word.slice(1)).join(' ') : 'Not recorded';
}

function constitutionEffectLabel(effect: string | null, decision: string) {
  switch (effect ?? decision) {
    case 'REQUIRE_APPROVAL': return 'Approval Required';
    case 'REQUIRE_HUMAN': return 'Human Review Required';
    case 'REQUIRE_SAFE_RESPONSE': return 'Safe Response Required';
    case 'BLOCK':
    case 'BLOCKED': return 'Blocked';
    case 'ALLOW':
    case 'ALLOWED': return 'No Constraint';
    case 'REQUIRES_REVIEW': return 'Review Required';
    default: return formatSandboxLabel(effect ?? decision);
  }
}

function constitutionTone(effect: string | null, decision: string): PresentationTone {
  const outcome = effect ?? decision;
  if (outcome === 'ALLOW' || outcome === 'ALLOWED') return 'positive';
  if (outcome === 'BLOCK' || outcome === 'BLOCKED') return 'danger';
  if (['REQUIRE_APPROVAL', 'REQUIRE_HUMAN', 'REQUIRE_SAFE_RESPONSE', 'REQUIRES_REVIEW'].includes(outcome)) return 'warning';
  return 'neutral';
}

function ruleCondition(rule: unknown): string | null {
  if (!rule || typeof rule !== 'object') return null;
  const constraint = (rule as { constraint?: unknown }).constraint;
  if (!constraint || typeof constraint !== 'object' || Array.isArray(constraint)) return null;
  const formatted = formatConstitutionCondition(constraint);
  return formatted === 'Condition details unavailable' ? null : formatted;
}

function conditionFromReason(reason: string | null): string | null {
  if (!reason) return null;
  const match = reason.match(/\bdiscounts?\s+(at or above|at least|above|over|greater than|more than|at or below|at most|below|under|less than)\s+(\d+(?:\.\d+)?)\s*%/i);
  if (!match) return null;
  const operator = /^(at or above|at least)$/i.test(match[1]) ? '≥' :
    /^(at or below|at most)$/i.test(match[1]) ? '≤' :
      /^(below|under|less than)$/i.test(match[1]) ? '<' : '>';
  const amount = Number(match[2]);
  return `Discount ${operator} ${Number.isInteger(amount) ? amount : Number(amount.toFixed(2))}%`;
}

export function presentConstitutionResult(row: ConstitutionResult) {
  const matched = row.matchedRuleIds.length > 0 || Boolean(row.winningRule);
  return {
    primary: constitutionEffectLabel(row.effect, row.decision),
    tone: constitutionTone(row.effect, row.decision),
    condition: ruleCondition(row.winningRule) ?? conditionFromReason(row.winnerReason),
    supporting: matched ? 'Matched company rule' :
      row.decision === 'ALLOW' || row.decision === 'ALLOWED' ? 'No matching rule' : 'Review the recorded rule outcome.',
    matchedRuleIds: row.matchedRuleIds,
    unresolvedRuleIds: row.unresolvedRuleIds,
  };
}

const automationStatePresentation: Record<string, { label: string; tone: PresentationTone; note: string }> = {
  READY: { label: 'Ready', tone: 'positive', note: 'Ready for routine handling.' },
  PENDING_APPROVAL: { label: 'Pending Approval', tone: 'warning', note: 'Awaiting human approval.' },
  ESCALATED: { label: 'Escalated', tone: 'warning', note: 'Routed for human review.' },
  BLOCKED: { label: 'Blocked', tone: 'danger', note: 'The action is blocked by policy.' },
  HELD: { label: 'On Hold', tone: 'neutral', note: 'Automation is paused by a hold.' },
  FAILED_UNCERTAIN: { label: 'Needs Confirmation', tone: 'warning', note: 'Execution needs human confirmation.' },
  REANALYSIS_REQUIRED: { label: 'Re-analysis Required', tone: 'warning', note: 'The decision needs to be reviewed again.' },
};

export function presentAutomationResult(value: AutomationResult) {
  const state = automationStatePresentation[value.state] ?? {
    label: formatSandboxLabel(value.state), tone: 'neutral' as const, note: 'Review the current automation state.',
  };
  const mode = value.resolvedMode === 'HUMAN_APPROVAL' ? 'Human Approval' :
    value.resolvedMode === 'AUTOPILOT' ? 'Autopilot' : formatSandboxLabel(value.resolvedMode);
  return { mode, state: state.label, tone: state.tone, note: state.note,
    executionNote: value.productionExecutionEnabled ? null : 'Production automatic execution is disabled.',
    reasons: value.reasons.map(formatSandboxLabel) };
}

export function presentRevenuePriority(value: RevenuePriorityResult) {
  const reason = value.reasons.find(item => item.trim()) ?? 'There is not enough recorded evidence to calculate this metric.';
  if (value.status === 'INSUFFICIENT_DATA' || value.score === null && value.status === 'APPLICABLE')
    return { primary: 'Not Scored', tone: 'neutral' as const, reason,
      metadata: [formatSandboxLabel(value.status), value.band && formatSandboxLabel(value.band), `${value.confidence} confidence`].filter(Boolean).join(' · '),
      score: null, simulatedBand: value.simulatedBand };
  if (value.status === 'NOT_APPLICABLE')
    return { primary: 'Not Applicable', tone: 'neutral' as const, reason,
      metadata: [formatSandboxLabel(value.status), value.band && formatSandboxLabel(value.band), `${value.confidence} confidence`].filter(Boolean).join(' · '),
      score: value.score, simulatedBand: value.simulatedBand };
  const band = value.band ? formatSandboxLabel(value.band) : null;
  return { primary: band ? `${band} Priority` : 'Scored', tone: 'neutral' as const, reason,
    metadata: [value.score === null ? null : `${value.score} / 100`, band, `${value.confidence} confidence`].filter(Boolean).join(' · '),
    score: value.score, simulatedBand: value.simulatedBand };
}

const slaReasonLabels: Record<string, string> = {
  INSUFFICIENT_RISK_DATA: 'Insufficient risk data',
  HUMAN_RESPONSIBILITY: 'Human review requires a response.',
  DECISION_NEEDS_REVIEW: 'The decision needs review.',
  OUTBOUND_ACTION_NOT_PERMITTED: 'No response action can be taken yet.',
  UNCERTAIN_EXECUTION_REQUIRES_HUMAN: 'Execution needs human confirmation.',
  SLA_POLICY_DISABLED: 'No response policy is enabled.',
  NO_HUMAN_RESPONSE_REQUIRED: 'No human response is required.',
};

export function presentResponseSla(value: ResponseSlaResult) {
  const reason = slaReasonLabels[value.reason] ?? formatSandboxLabel(value.reason);
  return {
    primary: value.applicable ? value.durationMinutes === null ? 'Response Window Set' : `${value.durationMinutes} Minute Response Window` : 'Not Applicable',
    tone: value.applicable ? 'neutral' as const : 'neutral' as const,
    reason,
    dueAt: value.hypotheticalDueAt,
    sourceRiskBand: value.sourceRiskBand,
  };
}
