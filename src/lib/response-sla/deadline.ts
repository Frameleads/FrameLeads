import type { RevenueRiskBand, ResponseSLAStatus } from '@prisma/client';

export const RESPONSE_SLA_VERSION = 'response-sla-v1';
export type DeadlinePolicy = { criticalMinutes: number; highMinutes: number; mediumMinutes: number;
  lowMinutes: number; unknownMinutes: number; dueSoonPercent: number };
export function calculateResponseDeadline(input: { startedAt: Date; riskBand: RevenueRiskBand | null;
  policy: DeadlinePolicy }) {
  if (!Number.isFinite(input.startedAt.getTime())) throw new TypeError('Valid start time required');
  const minutes = input.riskBand === 'CRITICAL' ? input.policy.criticalMinutes :
    input.riskBand === 'HIGH' ? input.policy.highMinutes : input.riskBand === 'MEDIUM' ? input.policy.mediumMinutes :
      input.riskBand === 'LOW' ? input.policy.lowMinutes : input.policy.unknownMinutes;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10_080) throw new TypeError('Invalid SLA duration');
  return new Date(input.startedAt.getTime() + minutes * 60_000);
}

/** Display-only state. No countdown writes and no independent timer. */
export function displayResponseSLA(input: { status: ResponseSLAStatus; startedAt: Date;
  dueAt: Date; dueSoonPercent: number }, now = new Date()) {
  if (input.status === 'RESOLVED' || input.status === 'CANCELLED')
    return { state: input.status, minutes: null };
  const remainingMs = input.dueAt.getTime() - now.getTime();
  if (input.status === 'BREACHED' || remainingMs <= 0)
    return { state: 'OVERDUE' as const, minutes: Math.ceil(Math.abs(remainingMs) / 60_000) };
  const total = input.dueAt.getTime() - input.startedAt.getTime();
  const fraction = total > 0 ? (now.getTime() - input.startedAt.getTime()) / total * 100 : 100;
  return { state: fraction >= input.dueSoonPercent ? 'DUE_SOON' as const : 'ACTIVE' as const,
    minutes: Math.ceil(remainingMs / 60_000) };
}

export type ApplicabilityInput = { decisionStatus: string; primaryIntent: string | null;
  riskStatus: string | null; automationState: string | null; automationMode: string | null;
  executionStatus: string | null; confirmedSuppression: boolean };
const NON_REVENUE = new Set(['SPAM', 'OUT_OF_OFFICE', 'UNSUBSCRIBE', 'WRONG_PERSON', 'NOT_INTERESTED']);
/** One applicability rule shared by materialization and refresh. */
export function responseSLAApplicability(input: ApplicabilityInput) {
  if (input.confirmedSuppression) return { applies: false, reason: 'CONFIRMED_SUPPRESSION' };
  if (input.decisionStatus === 'PENDING') return { applies: false, reason: 'DECISION_NOT_COMPLETE' };
  if (input.riskStatus === 'NOT_APPLICABLE' || (input.primaryIntent && NON_REVENUE.has(input.primaryIntent)))
    return { applies: false, reason: 'NON_REVENUE_DECISION' };
  if (input.executionStatus === 'SENT' || input.automationState === 'EXECUTED')
    return { applies: false, reason: 'RESPONSE_COMPLETED' };
  if (input.automationState === 'BLOCKED' || input.automationState === 'HELD')
    return { applies: false, reason: 'OUTBOUND_ACTION_NOT_PERMITTED' };
  if (input.automationState === 'FAILED_UNCERTAIN' || input.executionStatus === 'FAILED_UNCERTAIN')
    return { applies: true, reason: 'UNCERTAIN_EXECUTION_REQUIRES_HUMAN' };
  if (input.decisionStatus === 'NEEDS_REVIEW') return { applies: true, reason: 'DECISION_NEEDS_REVIEW' };
  if (input.automationMode === 'HUMAN_APPROVAL' || input.automationMode === 'MANDATORY_ESCALATION' ||
    input.automationState === 'PENDING_APPROVAL' || input.automationState === 'ESCALATED')
    return { applies: true, reason: 'HUMAN_RESPONSIBILITY' };
  return { applies: false, reason: 'NO_HUMAN_RESPONSE_REQUIRED' };
}

export function sortInboxByResponseSLA<T extends { id: string; responseSLA?: { status: string;
  startedAt: Date | string; dueAt: Date | string } | null }>(rows: readonly T[], now = new Date(), dueSoonPercent = 75): T[] {
  const priority = (row: T) => {
    const sla = row.responseSLA;
    if (!sla || sla.status === 'RESOLVED' || sla.status === 'CANCELLED') return { rank: 3, due: Infinity };
    const due = new Date(sla.dueAt).getTime();
    const started = new Date(sla.startedAt).getTime();
    if (sla.status === 'BREACHED' || due <= now.getTime()) return { rank: 0, due };
    if (now.getTime() >= started + (due - started) * dueSoonPercent / 100) return { rank: 1, due };
    return { rank: 2, due };
  };
  return rows.map((row, index) => ({ row, index, priority: priority(row) }))
    .sort((a, b) => a.priority.rank - b.priority.rank || a.priority.due - b.priority.due || a.index - b.index)
    .map(entry => entry.row);
}
