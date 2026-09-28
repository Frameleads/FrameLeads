import type { PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';

const HISTORY_LIMIT = 50;
const text = (value: string | null | undefined, max = 1000) => value?.slice(0, max) ?? null;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const strings = (value: unknown, max = 20) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, max) : [];
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
export type ReplayEvent = { at: string; type: string; title: string; detail: string | null;
  sourceType: string; sourceId: string };

/** Historical read model only. Never invokes mutable evaluators, providers, or lazy state builders. */
export async function getDecisionReplay(input: { userId: string; decisionId: string }, db: PrismaClient = prisma) {
  if (!input.userId || !input.decisionId || input.decisionId.length > 100) throw new TypeError('Tenant and Decision required');
  const decision = await db.decision.findFirst({ where: { id: input.decisionId, userId: input.userId },
    include: { trace: true,
      prospect: { select: { id: true, firstName: true, lastName: true, companyName: true } },
      conversation: { select: { id: true } },
      inputMessage: { select: { id: true, sourceType: true, sourceId: true, direction: true,
        body: true, occurredAt: true, providerId: true } } } });
  if (!decision) throw new Error('Decision not found for tenant');
  const [resolutions, actions, assignment, execution, risk, sla, outcomes] = await Promise.all([
    db.decisionAutomationResolution.findMany({ where: { userId: input.userId, decisionId: decision.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: HISTORY_LIMIT + 1 }),
    db.decisionActionEvent.findMany({ where: { userId: input.userId, decisionId: decision.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: HISTORY_LIMIT + 1 }),
    db.decisionAssignment.findUnique({ where: { userId_decisionId: { userId: input.userId, decisionId: decision.id } } }),
    db.decisionExecutionAttempt.findUnique({ where: { userId_decisionId: { userId: input.userId, decisionId: decision.id } } }),
    db.decisionRevenueRisk.findUnique({ where: { userId_decisionId: { userId: input.userId, decisionId: decision.id } } }),
    db.responseSLAInstance.findUnique({ where: { userId_decisionId: { userId: input.userId, decisionId: decision.id } } }),
    db.decisionOutcome.findMany({ where: { userId: input.userId, decisionId: decision.id },
      orderBy: { revision: 'desc' }, take: 25 }),
  ]);
  const resolutionHistoryTruncated = resolutions.length > HISTORY_LIMIT;
  const actionHistoryTruncated = actions.length > HISTORY_LIMIT;
  const automation = resolutions.slice(0, HISTORY_LIMIT).reverse();
  const humanActions = actions.slice(0, HISTORY_LIMIT).reverse();
  // OutboundLog has no decisionId. Correlate only by the persisted provider message ID and tenant-owned conversation.
  const outboundMatches = execution?.providerMessageId ? await db.conversationMessage.findMany({ where: {
    userId: input.userId, conversationId: decision.conversationId, prospectId: decision.prospectId,
    sourceType: 'OUTBOUND_LOG', providerId: execution.providerMessageId },
    take: 2, select: { id: true, sourceId: true, occurredAt: true, providerId: true } }) : [];
  const outboundMessage = outboundMatches.length === 1 ? outboundMatches[0] : null;
  const outboundLog = outboundMessage ? await db.outboundLog.findFirst({ where: { id: outboundMessage.sourceId,
    lead: { userId: input.userId, prospectId: decision.prospectId } },
    select: { id: true, status: true, sentAt: true, channel: true } }) : null;
  const trace = decision.trace;
  const icp = object(trace?.icpState);
  const memory = object(trace?.memoryState);
  const refs = object(trace?.contextReferences);
  const policy = Array.isArray(trace?.policyResult) ? trace.policyResult.slice(0, 20).map(raw => {
    const row = object(raw);
    return row ? { action: text(typeof row.action === 'string' ? row.action : null, 100),
      decision: text(typeof row.decision === 'string' ? row.decision : null, 100),
      effectiveEffect: text(typeof row.effectiveEffect === 'string' ? row.effectiveEffect : null, 100),
      winningRule: text(typeof row.winningRule === 'string' ? row.winningRule : null, 100),
      winnerReason: text(typeof row.winnerReason === 'string' ? row.winnerReason : null, 400),
      matchedRuleIds: strings(row.matchedRuleIds, 100), unresolvedRuleIds: strings(row.unresolvedRuleIds, 100),
      blockingRuleIds: strings(row.blockingRuleIds, 100),
      ruleTrace: Array.isArray(row.ruleTrace) ? row.ruleTrace.slice(0, 100).map(item => {
        const rule = object(item); return rule ? { ruleId: text(typeof rule.ruleId === 'string' ? rule.ruleId : null, 100),
          result: text(typeof rule.finalEffectiveResult === 'string' ? rule.finalEffectiveResult : null, 100) } : null;
      }).filter(item => item !== null) : [] } : null;
  }).filter(item => item !== null) : [];
  const timeline: ReplayEvent[] = [];
  const add = (at: Date | null | undefined, type: string, title: string, detail: string | null,
    sourceType: string, sourceId: string) => { if (at) timeline.push({ at: at.toISOString(), type, title,
      detail: text(detail, 500), sourceType, sourceId }); };
  add(decision.inputMessage.occurredAt, 'INBOUND_REPLY', 'Triggering message received',
    text(decision.inputMessage.body, 240), 'CONVERSATION_MESSAGE', decision.inputMessage.id);
  add(decision.createdAt, 'DECISION_CREATED', 'Decision created', decision.decisionType, 'DECISION', decision.id);
  add(trace?.createdAt, 'POLICY_APPLIED', 'Decision-time governance recorded',
    policy.length ? policy.map(row => row.decision ?? 'UNAVAILABLE').join(', ') : 'Policy result not recorded',
    'DECISION_TRACE', trace?.id ?? decision.id);
  for (const row of automation) add(row.createdAt, 'AUTOMATION_RESOLVED', 'Automation resolved',
    `${row.resolvedMode} · ${row.state}`, 'AUTOMATION_RESOLUTION', row.id);
  if (risk) add(risk.evaluatedAt, 'RISK_ASSESSED', 'Latest persisted risk assessment',
    `${risk.status} · ${risk.band ?? 'UNKNOWN'}`, 'DECISION_REVENUE_RISK', risk.id);
  if (sla) {
    add(sla.startedAt, 'SLA_STARTED', 'Response SLA started', `Due ${sla.dueAt.toISOString()}`, 'RESPONSE_SLA', sla.id);
    add(sla.breachedAt, 'SLA_BREACHED', 'Response SLA breached', sla.escalationReason, 'RESPONSE_SLA', sla.id);
    add(sla.resolvedAt, 'SLA_RESOLVED', 'Response SLA resolved', sla.resolutionReason, 'RESPONSE_SLA', sla.id);
    add(sla.cancelledAt, 'SLA_CANCELLED', 'Response SLA cancelled', sla.resolutionReason, 'RESPONSE_SLA', sla.id);
  }
  if (assignment) {
    add(assignment.assignedAt, 'ASSIGNMENT_RECORDED', 'Human assignment recorded',
      'Assignment exists; queue and reason shown separately are its current recorded values.',
      'DECISION_ASSIGNMENT', assignment.id);
    add(assignment.resolvedAt, 'ASSIGNMENT_RESOLVED', 'Human assignment resolved', null,
      'DECISION_ASSIGNMENT', assignment.id);
  }
  for (const row of humanActions) add(row.createdAt, `HUMAN_${row.action}`, `Human ${row.action.toLowerCase().replaceAll('_', ' ')}`,
    row.reason, 'DECISION_ACTION', row.id);
  for (const row of outcomes) add(row.createdAt, 'BUSINESS_OUTCOME_RECORDED',
    row.revision === 1 ? 'Business outcome recorded' : 'Business outcome corrected',
    `${row.outcomeType} · Occurred ${row.occurredAt.toISOString()}`, 'DECISION_OUTCOME', row.id);
  if (execution) {
    add(execution.startedAt, 'EXECUTION_STARTED', 'Execution attempt started', execution.mode,
      'EXECUTION_ATTEMPT', execution.id);
    add(execution.completedAt, execution.status === 'SENT' ? 'EXECUTION_SUCCEEDED' : 'EXECUTION_FAILED',
      execution.status === 'SENT' ? 'Execution recorded as sent' : 'Execution ended without a confirmed send',
      execution.failureClass, 'EXECUTION_ATTEMPT', execution.id);
  }
  if (outboundLog && outboundMessage) add(outboundMessage.occurredAt, 'MESSAGE_SENT',
    'Outbound message recorded', `${outboundLog.channel} · ${outboundLog.status}`, 'OUTBOUND_LOG', outboundLog.id);
  timeline.sort((a, b) => a.at.localeCompare(b.at) || a.type.localeCompare(b.type) || a.sourceId.localeCompare(b.sourceId));
  const lastResolution = automation.at(-1);
  const rejected = humanActions.some(row => row.action === 'REJECT');
  const finalState = execution?.status === 'SENT' ? 'SENT' : execution?.status === 'FAILED_UNCERTAIN' ? 'FAILED_UNCERTAIN' :
    rejected ? 'REJECTED' : lastResolution?.state ?? (decision.status === 'FAILED' ? 'FAILED' : 'UNRESOLVED');
  return {
    trigger: { decisionId: decision.id, decisionType: decision.decisionType, status: decision.status,
      source: decision.source, decisionAt: decision.createdAt.toISOString(), prospect: decision.prospect,
      conversationId: decision.conversation.id, message: { id: decision.inputMessage.id,
        sourceType: decision.inputMessage.sourceType, sourceId: decision.inputMessage.sourceId,
        direction: decision.inputMessage.direction, body: text(decision.inputMessage.body, 4000),
        occurredAt: decision.inputMessage.occurredAt.toISOString() } },
    knownAtDecision: { contextFingerprint: trace?.contextFingerprint ?? decision.contextFingerprint,
      engineVersion: trace?.engineVersion ?? null, icp: icp ? { qualification: icp.qualification ?? null,
        fitScore: number(icp.fitScore), fitTier: icp.fitTier ?? null, valueBand: icp.valueBand ?? null,
        researchStatus: icp.researchStatus ?? null } : null,
      memory: memory ? { eventCount: number(memory.eventCount), lastEventAt: memory.lastEventAt ?? null,
        eventIds: strings(memory.eventIds, 20) } : null,
      brainRevision: trace?.brainRevision ?? null, brainEntryIds: trace?.brainEntryIds.slice(0, 20) ?? [],
      playbookRevision: trace?.playbookRevision ?? null, playbookRuleIds: trace?.playbookRuleIds.slice(0, 20) ?? [],
      constitutionRevision: trace?.constitutionRevision ?? null,
      constitutionRuleIds: strings(refs?.constitutionRuleIds, 20),
      provider: decision.provider, model: decision.model },
    interpretation: { primaryIntent: decision.primaryIntent, secondaryIntents: decision.secondaryIntents,
      intentSignals: Array.isArray(decision.intentSignals) ? decision.intentSignals.slice(0, 5) : null,
      confidenceScore: decision.confidenceScore, conciseInterpretation: text(decision.interpretation, 350),
      reviewRequired: decision.requiresReview, reviewReasons: decision.reviewReasons.slice(0, 20),
      suggestedReply: text(decision.suggestedReply, 1000), recommendedNextAction: text(decision.recommendedNextAction, 500),
      explanation: text(decision.explanation, 500) },
    governance: { decisionTime: trace ? { revision: trace.constitutionRevision, recordedAt: trace.createdAt.toISOString(),
      policy } : null,
      executionTime: execution ? { decisionConstitutionRevision: execution.decisionConstitutionRevision,
        executionConstitutionRevision: execution.executionConstitutionRevision } : null },
    automation: { history: automation.map(row => ({ id: row.id, at: row.createdAt.toISOString(),
      requestedMode: row.requestedMode, resolvedMode: row.resolvedMode, state: row.state,
      reasons: row.reasons.slice(0, 20), policyRevision: row.policyRevision,
      decisionConstitutionRevision: row.decisionConstitutionRevision,
      currentConstitutionRevision: row.currentConstitutionRevision,
      constitutionRuleIds: row.constitutionRuleIds.slice(0, 100),
      prospectHoldId: row.prospectHoldId, campaignOverrideId: row.campaignOverrideId })),
      truncated: resolutionHistoryTruncated },
    risk: risk ? { provenance: 'LATEST_PERSISTED_ASSESSMENT', status: risk.status, score: risk.score,
      band: risk.band, confidence: risk.confidence, reasons: risk.reasons.slice(0, 20),
      components: Array.isArray(risk.components) ? risk.components.slice(0, 20) : [],
      scoringVersion: risk.scoringVersion, evaluatedAt: risk.evaluatedAt.toISOString() } : null,
    sla: sla ? { status: sla.status, startedAt: sla.startedAt.toISOString(), dueAt: sla.dueAt.toISOString(),
      initialRiskBand: sla.riskBandAtStart, initialRiskScore: sla.riskScoreAtStart,
      policyRevision: sla.policyRevision, breachedAt: sla.breachedAt?.toISOString() ?? null,
      escalationLevel: sla.escalationLevel, escalationReason: sla.escalationReason,
      resolvedAt: sla.resolvedAt?.toISOString() ?? null, cancelledAt: sla.cancelledAt?.toISOString() ?? null,
      resolutionReason: sla.resolutionReason } : null,
    human: { actions: humanActions.map(row => ({ id: row.id, at: row.createdAt.toISOString(),
      action: row.action, actorUserId: row.actorUserId, reason: text(row.reason, 500),
      resultingState: row.resultingState, executionAttemptId: row.executionAttemptId,
      editedDraft: text(row.editedDraft, 1000) })), truncated: actionHistoryTruncated,
      assignment: assignment ? { id: assignment.id, status: assignment.status, queue: assignment.queue,
        reason: text(assignment.reason, 500), assignedAt: assignment.assignedAt.toISOString(),
        resolvedAt: assignment.resolvedAt?.toISOString() ?? null,
        provenance: 'CURRENT_RECORDED_ASSIGNMENT' } : null },
    execution: execution ? { id: execution.id, status: execution.status, mode: execution.mode,
      startedAt: execution.startedAt.toISOString(), completedAt: execution.completedAt?.toISOString() ?? null,
      provider: execution.provider, providerMessageId: execution.providerMessageId,
      failureClass: execution.failureClass,
      outbound: outboundLog ? { id: outboundLog.id, status: outboundLog.status,
        channel: outboundLog.channel, sentAt: outboundLog.sentAt.toISOString() } : null } : null,
    outcomes: { current: outcomes[0] ? { id: outcomes[0].id, revision: outcomes[0].revision,
      outcomeType: outcomes[0].outcomeType, source: outcomes[0].source,
      note: text(outcomes[0].note, 500), occurredAt: outcomes[0].occurredAt.toISOString(),
      recordedAt: outcomes[0].createdAt.toISOString() } : null,
      history: outcomes.map(row => ({ id: row.id, revision: row.revision, outcomeType: row.outcomeType,
        source: row.source, note: text(row.note, 500), occurredAt: row.occurredAt.toISOString(),
        recordedAt: row.createdAt.toISOString() })), truncated: outcomes.length === 25 },
    finalState: { state: finalState, slaStatus: sla?.status ?? null }, timeline,
  };
}
