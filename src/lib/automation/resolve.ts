import { AutomationExecutionState as State, AutomationMode as Mode, CampaignAutomationMode as CampaignMode,
  ConstitutionScope as Scope, DecisionStatus, DecisionExecutionStatus, TriageIntent,
  type PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { evaluateSalesConstitution } from '../sales-constitution';
import { topicFor } from '../decision/triage';
import { automaticExecutionRolloutEnabled, getAutomationPolicy } from './policy';
import { hasFeatureAccess, normalizeFrameLeadsTier } from '../entitlements';

type Evaluation = Awaited<ReturnType<typeof evaluateSalesConstitution>>;
const MAX_REASON = 12;
const fallback = (mode: Mode) => mode === Mode.MANDATORY_ESCALATION ? Mode.MANDATORY_ESCALATION : Mode.HUMAN_APPROVAL;

/** All factual controls are re-read at call time. This function makes no AI or send call. */
export async function evaluateAutomationMode(input: { userId: string; decisionId: string;
  proposedReply?: string | null; simulation?: { primaryIntent?: TriageIntent | null;
    secondaryIntents?: TriageIntent[];
    confidenceScore?: number; requiresReview?: boolean; reviewReasons?: string[];
    status?: DecisionStatus; requestedMode?: Mode; holdActive?: boolean;
    riskBand?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' } }, db: PrismaClient = prisma) {
  if (!input.userId || !input.decisionId) throw new TypeError('Tenant and Decision required');
  const storedDecision = await db.decision.findFirst({ where: { id: input.decisionId, userId: input.userId },
    include: { trace: true, inputMessage: { select: { sourceId: true, sourceType: true } } } });
  if (!storedDecision) throw new Error('Decision not found for tenant');
  const decision = { ...storedDecision, ...input.simulation && {
    primaryIntent: input.simulation.primaryIntent === undefined ? storedDecision.primaryIntent : input.simulation.primaryIntent,
    secondaryIntents: input.simulation.secondaryIntents === undefined ? storedDecision.secondaryIntents : input.simulation.secondaryIntents,
    confidenceScore: input.simulation.confidenceScore ?? storedDecision.confidenceScore,
    requiresReview: input.simulation.requiresReview ?? storedDecision.requiresReview,
    reviewReasons: input.simulation.reviewReasons ?? storedDecision.reviewReasons,
    status: input.simulation.status ?? storedDecision.status } };
  const policy = await getAutomationPolicy(input.userId, db);
  const reply = input.proposedReply === undefined ? decision.suggestedReply : input.proposedReply;
  const [source, hold, suppression, execution, lastAction, brain, playbook, user] = await Promise.all([
    db.inboundSignal.findFirst({ where: { id: decision.inputMessage.sourceId, userId: input.userId },
      select: { id: true, generatedLeadId: true, prospectContext: true,
        generatedLead: { select: { id: true, listId: true, email: true } } } }),
    db.prospectHold.findUnique({ where: { userId_prospectId: { userId: input.userId, prospectId: decision.prospectId } } }),
    db.inboundSignal.findFirst({ where: { userId: input.userId, prospectId: decision.prospectId,
      sourceType: 'PROVIDER_CONFIRMED', signalType: 'UNSUBSCRIBE_CONFIRMED' }, select: { id: true } }),
    db.decisionExecutionAttempt.findUnique({ where: { userId_decisionId: { userId: input.userId, decisionId: decision.id } } }),
    db.decisionActionEvent.findFirst({ where: { userId: input.userId, decisionId: decision.id }, orderBy: { createdAt: 'desc' } }),
    db.frameLeadsBrain.findUnique({ where: { userId: input.userId }, select: { revision: true } }),
    db.revenuePlaybook.findUnique({ where: { userId: input.userId }, select: { revision: true } }),
    db.user.findUnique({ where: { id: input.userId }, select: { imapEmail: true, imapPassword: true, imapHost: true, tier: true, email: true } }),
  ]);
  if (!source || decision.inputMessage.sourceType !== 'INBOUND_SIGNAL') throw new Error('Decision inbound source not found for tenant');
  const override = source.generatedLead?.listId ? await db.automationCampaignOverride.findUnique({
    where: { userId_leadListId: { userId: input.userId, leadListId: source.generatedLead.listId } } }) : null;
  let requestedMode = policy.defaultMode;
  if (override && override.mode !== CampaignMode.INHERIT && override.mode !== CampaignMode.DISABLE_AUTOMATION)
    requestedMode = override.mode as Mode;
  if (input.simulation?.requestedMode) requestedMode = input.simulation.requestedMode;
  const reasons: string[] = [];
  const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL?.trim().toLowerCase();
  const tier = adminEmail && user?.email?.trim().toLowerCase() === adminEmail ? 'ENTERPRISE' : normalizeFrameLeadsTier(user?.tier);
  if (!hasFeatureAccess(tier, 'AUTOMATION') && requestedMode === Mode.AUTOPILOT) {
    requestedMode = Mode.HUMAN_APPROVAL;
    reasons.push('ENTERPRISE_AUTOMATION_NOT_ENTITLED');
  }
  if (override?.mode === CampaignMode.DISABLE_AUTOMATION) reasons.push('LEAD_LIST_AUTOMATION_DISABLED');
  const topic = decision.primaryIntent ? topicFor(decision.primaryIntent as TriageIntent) : null;
  const contextRef = { prospectId: decision.prospectId, decisionId: decision.id,
    primaryIntent: decision.primaryIntent, secondaryIntents: decision.secondaryIntents,
    confidence: decision.confidenceScore, riskBandOverride: input.simulation?.riskBand };
  const evaluations: Evaluation[] = [await evaluateSalesConstitution({ userId: input.userId,
    action: { actionType: 'OUTREACH', scope: Scope.OUTBOUND, unsubscribeConfirmed: Boolean(suppression), contextRef } }, db)];
  if (topic) evaluations.push(await evaluateSalesConstitution({ userId: input.userId,
    action: { actionType: 'TOPIC_RESPONSE', topic: topic.category, scope: topic.scope, contextRef } }, db));
  if (reply?.trim()) evaluations.push(await evaluateSalesConstitution({ userId: input.userId,
    action: { actionType: 'CLAIM', proposedClaim: reply.trim().slice(0, 3000), scope: Scope.REPLY_DECISION, contextRef } }, db));
  const ruleIds = [...new Set(evaluations.flatMap(result => result.matchedRules.map(rule => rule.id)))];
  const currentConstitutionRevision = Math.max(...evaluations.map(result => result.revision));
  const decisionConstitutionRevision = decision.trace?.constitutionRevision ?? null;
  const has = (key: 'blockingRules' | 'humanReviewRequirements' | 'approvalRequirements' | 'safeResponseRequirements' | 'unresolvedRules') =>
    evaluations.some(result => result[key].length > 0);
  const unconfigured = evaluations.some(result => result.configurationMissing);
  const staleContext = Boolean(decision.trace &&
    ((decision.trace.brainRevision != null && brain?.revision !== decision.trace.brainRevision) ||
      (decision.trace.playbookRevision != null && playbook?.revision !== decision.trace.playbookRevision)));
  const integrationAvailable = Boolean(user?.imapEmail && user.imapPassword && user.imapHost && source.generatedLead?.email);
  const blocked = Boolean(suppression) || has('blockingRules');
  let resolvedMode: Mode = requestedMode;
  let state: State = requestedMode === Mode.MANDATORY_ESCALATION ? State.ESCALATED :
    requestedMode === Mode.HUMAN_APPROVAL ? State.PENDING_APPROVAL : State.READY;

  if (execution?.status === DecisionExecutionStatus.SENT) {
    state = State.EXECUTED;
    resolvedMode = execution.mode;
    reasons.push('ALREADY_EXECUTED');
  } else if (execution) {
    state = execution.status === DecisionExecutionStatus.FAILED_UNCERTAIN ? State.FAILED_UNCERTAIN : State.EXECUTING;
    resolvedMode = execution.mode;
    reasons.push('EXECUTION_ALREADY_CLAIMED');
  } else if (lastAction?.action === 'REJECT') {
    state = State.REJECTED; resolvedMode = Mode.HUMAN_APPROVAL; reasons.push('HUMAN_REJECTED');
  } else if (lastAction?.action === 'ESCALATE') {
    state = State.ESCALATED; resolvedMode = Mode.MANDATORY_ESCALATION; reasons.push('HUMAN_ESCALATED');
  } else if (blocked) {
    state = State.BLOCKED; resolvedMode = Mode.MANDATORY_ESCALATION;
    reasons.push(suppression ? 'CONFIRMED_UNSUBSCRIBE' : 'CONSTITUTION_BLOCK');
  } else if (input.simulation?.holdActive ?? hold?.active) {
    state = State.HELD; resolvedMode = Mode.MANDATORY_ESCALATION; reasons.push('PROSPECT_HOLD');
  } else if (has('humanReviewRequirements') || has('safeResponseRequirements') || has('unresolvedRules') || unconfigured ||
    decision.primaryIntent === TriageIntent.UNSUBSCRIBE) {
    state = State.ESCALATED; resolvedMode = Mode.MANDATORY_ESCALATION;
    if (has('humanReviewRequirements')) reasons.push('CONSTITUTION_REQUIRES_HUMAN');
    if (has('safeResponseRequirements')) reasons.push('CONSTITUTION_REQUIRES_SAFE_RESPONSE');
    if (has('unresolvedRules') || unconfigured) reasons.push('CONSTITUTION_UNRESOLVED');
    if (decision.primaryIntent === TriageIntent.UNSUBSCRIBE) reasons.push('UNSUBSCRIBE_INTENT_REQUIRES_CONFIRMATION');
  } else if (requestedMode === Mode.MANDATORY_ESCALATION) {
    state = State.ESCALATED; resolvedMode = Mode.MANDATORY_ESCALATION; reasons.push('REQUESTED_ESCALATION');
  } else if (requestedMode === Mode.HUMAN_APPROVAL || has('approvalRequirements')) {
    state = State.PENDING_APPROVAL; resolvedMode = Mode.HUMAN_APPROVAL;
    if (has('approvalRequirements')) reasons.push('CONSTITUTION_REQUIRES_APPROVAL');
  } else {
    if (override?.mode === CampaignMode.DISABLE_AUTOMATION || policy.autoExecutionDisabled || !policy.autopilotEnabled ||
      !automaticExecutionRolloutEnabled()) reasons.push('AUTOMATIC_EXECUTION_DISABLED');
    if (decision.status !== DecisionStatus.READY || decision.requiresReview || decision.reviewReasons.length)
      reasons.push('DECISION_REQUIRES_REVIEW');
    if ((decision.confidenceScore ?? 0) < policy.autopilotMinConfidence) reasons.push('CONFIDENCE_BELOW_AUTOPILOT_THRESHOLD');
    if (!reply?.trim()) reasons.push('MISSING_SAFE_REPLY');
    if (!integrationAvailable) reasons.push('OUTBOUND_INTEGRATION_UNAVAILABLE');
    if (staleContext) reasons.push('REANALYSIS_REQUIRED');
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sentToday = await db.decisionExecutionAttempt.count({ where: { userId: input.userId,
      mode: Mode.AUTOPILOT, status: DecisionExecutionStatus.SENT, startedAt: { gte: since } } });
    if (sentToday >= policy.maxAutoSendsPerDay) reasons.push('AUTOPILOT_DAILY_LIMIT');
    if (reasons.length) {
      resolvedMode = fallback(policy.fallbackMode);
      state = resolvedMode === Mode.MANDATORY_ESCALATION ? State.ESCALATED : State.PENDING_APPROVAL;
    }
  }
  if (staleContext && resolvedMode !== Mode.AUTOPILOT && state === State.PENDING_APPROVAL) reasons.push('CONTEXT_CHANGED_SINCE_DECISION');
  return { decision, source, policy, override, hold, suppression, execution, lastAction, requestedMode, resolvedMode, state,
    reasons: [...new Set(reasons)].slice(0, MAX_REASON), confidence: decision.confidenceScore,
    policyRevision: policy.revision, decisionConstitutionRevision, currentConstitutionRevision,
    constitutionRuleIds: ruleIds, campaignOverrideId: override?.id ?? null, prospectHoldId: hold?.active ? hold.id : null,
    integrationAvailable, staleContext, evaluations };
}

/** Persist only meaningful changes. DecisionTrace remains immutable. */
export async function resolveAutomationMode(input: { userId: string; decisionId: string;
  proposedReply?: string | null }, db: PrismaClient = prisma) {
  const result = await evaluateAutomationMode(input, db);
  const data = { userId: input.userId, decisionId: input.decisionId, requestedMode: result.requestedMode,
    resolvedMode: result.resolvedMode, state: result.state, reasons: result.reasons,
    confidence: result.confidence, policyRevision: result.policyRevision,
    decisionConstitutionRevision: result.decisionConstitutionRevision,
    currentConstitutionRevision: result.currentConstitutionRevision,
    constitutionRuleIds: result.constitutionRuleIds,
    campaignOverrideId: result.campaignOverrideId, prospectHoldId: result.prospectHoldId };
  const previous = await db.decisionAutomationResolution.findFirst({ where: { userId: input.userId,
    decisionId: input.decisionId }, orderBy: { createdAt: 'desc' } });
  const unchanged = previous && Object.entries(data).every(([key, value]) =>
    JSON.stringify(previous[key as keyof typeof previous]) === JSON.stringify(value));
  const snapshot = unchanged ? previous : await db.decisionAutomationResolution.create({ data });
  if (result.state === State.ESCALATED) await db.decisionAssignment.upsert({ where: { userId_decisionId: {
    userId: input.userId, decisionId: input.decisionId } }, create: { userId: input.userId,
    decisionId: input.decisionId, queue: 'HUMAN_REVIEW', reason: result.reasons.join(', ').slice(0, 360) || 'Mandatory human escalation.' },
    update: { status: 'OPEN', reason: result.reasons.join(', ').slice(0, 360) || 'Mandatory human escalation.', resolvedAt: null } });
  return { ...result, snapshot };
}
