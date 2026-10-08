import { createHash } from 'node:crypto';
import { AIFeature, AIOperation, AIProvider, AIUsageStatus, ConstitutionCategory as Category,
  ConstitutionScope as Scope, ConversationSourceType as MessageSource, DecisionSource as Source,
  DecisionStatus as Status, DecisionType, TriageIntent as Intent, type Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { recordAIUsage, type AIUsageTokens } from '../ai/usage';
import { evaluateSalesConstitution } from '../sales-constitution';
import { buildSalesConstitutionFacts } from '../sales-constitution-facts';
import { getInboundConversationMessage } from './conversation';
import { buildReplyDecisionContext, DECISION_ENGINE_VERSION } from './context';
import { realPreviewReply, reserveTriageDecision } from './activation-preview';
import { selectTriageProvider, TRIAGE_MODEL, validateTriageOutput,
  classifyTriageFailure, safeGoogleDiagnostic, type TriageFailureClass, type TriageAnalysis, type TriageProvider } from './provider';

export type TriageDependencies = { db?: PrismaClient; provider?: TriageProvider; recordUsage?: typeof recordAIUsage;
  buildContext?: typeof buildReplyDecisionContext; evaluatePolicy?: typeof evaluateSalesConstitution };
const MAX_REVIEW_REASONS = 8;
const cap = (value: string | null | undefined, max: number) => (value ?? '').trim().slice(0, max);

/** Only server-owned structured source markers can take a deterministic fast path. */
export function deterministicTriageSignal(signal: { sourceType: string; signalType: string | null }) {
  if (signal.sourceType === 'IMAP_NATIVE' && signal.signalType === 'SYSTEM_AUTO_REPLY')
    return { intent: Intent.OUT_OF_OFFICE, action: 'REVIEW_MANUALLY' as const, explanation: 'Mail headers identify an automated reply.' };
  if (signal.sourceType === 'PROVIDER_CONFIRMED' && signal.signalType === 'UNSUBSCRIBE_CONFIRMED')
    return { intent: Intent.UNSUBSCRIBE, action: 'NO_SALES_OUTREACH' as const, explanation: 'Authenticated provider event confirms an unsubscribe.' };
  return null;
}
export function topicFor(intent: Intent): { category: Category; scope: Scope } | null {
  if (([Intent.PRICING_INQUIRY, Intent.PRICING_OBJECTION, Intent.BUDGET_OBJECTION, Intent.NEGOTIATION] as Intent[]).includes(intent))
    return { category: Category.PRICING, scope: Scope.PRICING };
  if (intent === Intent.LEGAL) return { category: Category.LEGAL, scope: Scope.LEGAL };
  if (intent === Intent.COMPLIANCE) return { category: Category.COMPLIANCE, scope: Scope.COMPLIANCE };
  if (intent === Intent.SECURITY) return { category: Category.SECURITY, scope: Scope.SECURITY };
  if (intent === Intent.COMPETITOR_OBJECTION) return { category: Category.COMPETITOR, scope: Scope.REPLY_DECISION };
  if (intent === Intent.UNSUBSCRIBE) return { category: Category.UNSUBSCRIBE, scope: Scope.REPLY_DECISION };
  return null;
}
export function decideReview(input: { analysis: TriageAnalysis | null; policy: { decision: string;
  unresolvedRules: unknown[]; blockingRules: unknown[]; approvalRequirements: unknown[];
  humanReviewRequirements: unknown[]; safeResponseRequirements: unknown[]; configurationMissing?: boolean }[];
  failure?: string | null }) {
  const reasons: string[] = [];
  if (input.failure) reasons.push(input.failure);
  if (!input.analysis) reasons.push('INTENT_UNRESOLVED');
  else {
    if (input.analysis.overallConfidence < 70 || input.analysis.intents.find(v => v.intent === input.analysis!.primaryIntent)!.confidence < 65)
      reasons.push('LOW_CONFIDENCE');
    const labels = new Set(input.analysis.intents.map(v => v.intent));
    if ((labels.has(Intent.POSITIVE_INTEREST) && (labels.has(Intent.NOT_INTERESTED) || labels.has(Intent.UNSUBSCRIBE))) ||
      (labels.has(Intent.MEETING_REQUEST) && labels.has(Intent.NOT_INTERESTED))) reasons.push('CONTRADICTORY_INTENTS');
  }
  if (input.policy.some(p => p.configurationMissing)) reasons.push('CONSTITUTION_UNCONFIGURED');
  if (input.policy.some(p => p.unresolvedRules.length)) reasons.push('POLICY_UNRESOLVED');
  if (input.policy.some(p => p.blockingRules.length)) reasons.push('POLICY_BLOCKED');
  if (input.policy.some(p => p.approvalRequirements.length)) reasons.push('APPROVAL_REQUIRED');
  if (input.policy.some(p => p.humanReviewRequirements.length)) reasons.push('HUMAN_REVIEW_REQUIRED');
  if (input.policy.some(p => p.safeResponseRequirements.length)) reasons.push('SAFE_RESPONSE_REQUIRED');
  return [...new Set(reasons)].slice(0, MAX_REVIEW_REASONS);
}

function policySnapshot(result: Awaited<ReturnType<typeof evaluateSalesConstitution>>) {
  return { authority: result.authority, revision: result.revision, decision: result.decision,
    effectiveEffect: result.effectiveEffect, winningRule: result.winningRule,
    winnerReason: cap(result.winnerReason, 400), configurationMissing: result.configurationMissing,
    unresolvedPotentiallyOverrides: result.unresolvedPotentiallyOverrides,
    matchedRuleIds: result.matchedRules.map(r => r.id).slice(0, 100),
    blockingRuleIds: result.blockingRules.map(r => r.id).slice(0, 100),
    unresolvedRuleIds: result.unresolvedRules.map(r => r.id).slice(0, 100),
    ruleTrace: result.trace.slice(0, 100).map(item => ({ ruleId: item.ruleId, scope: item.scope,
      severity: item.severity, effect: item.effect, matchResult: item.matchResult,
      finalEffectiveResult: item.finalEffectiveResult,
      conditions: item.conditions.map(c => ({ field: c.field, result: c.result })) })),
    traceTruncated: result.trace.length > 100 };
}

export async function triageInboundSignal(input: { userId: string; signalId: string;
  retryOfDecisionId?: string; activationPreview?: boolean }, deps: TriageDependencies = {}) {
  const db = deps.db ?? prisma;
  if (!input.userId?.trim() || !input.signalId?.trim()) throw new TypeError('Tenant and signal required');
  const linked = await getInboundConversationMessage(input, db);
  if (!linked.conversation || !linked.message || !linked.signal.prospectId)
    return { status: Status.NEEDS_REVIEW, decision: null, reason: 'PROSPECT_IDENTITY_UNRESOLVED' };
  if (input.activationPreview) {
    if (input.retryOfDecisionId || !realPreviewReply(linked.signal, input.userId)) throw new Error('REAL_PROVIDER_REPLY_REQUIRED');
    const lead = await db.generatedLead.findFirst({ where: { userId: input.userId, prospectId: linked.signal.prospectId }, select: { id: true } });
    if (!lead) throw new Error('CONTROLLED_WORKFLOW_PROSPECT_REQUIRED');
  }
  const context = await (deps.buildContext ?? buildReplyDecisionContext)({ userId: input.userId,
    prospectId: linked.signal.prospectId, conversationId: linked.conversation.id, messageId: linked.message.id }, db);
  let fingerprint = context.contextFingerprint;
  let supersedesDecisionId: string | null = null;
  if (input.retryOfDecisionId) {
    const prior = await db.decision.findFirst({ where: { id: input.retryOfDecisionId, userId: input.userId,
      inputMessageId: linked.message.id, decisionType: DecisionType.INBOUND_TRIAGE } });
    if (!prior || prior.status === Status.PENDING) throw new Error('Retry source not found or still pending');
    supersedesDecisionId = prior.id;
    fingerprint = createHash('sha256').update(`${context.contextFingerprint}:retry:${prior.id}`).digest('hex');
  }
  const key = { userId: input.userId, inputMessageId: linked.message.id,
    decisionType: DecisionType.INBOUND_TRIAGE, contextFingerprint: fingerprint };
  const cached = await db.decision.findUnique({ where: { userId_inputMessageId_decisionType_contextFingerprint: key }, include: { trace: true } });
  if (cached) return { status: cached.status, decision: cached, reused: true };
  if (!input.retryOfDecisionId) {
    const previous = await db.decision.findFirst({ where: { userId: input.userId, inputMessageId: linked.message.id,
      decisionType: DecisionType.INBOUND_TRIAGE }, orderBy: { createdAt: 'desc' }, include: { trace: true } });
    if (previous) return { status: previous.status, decision: previous, reused: true };
  }
  let pending;
  try {
    pending = await reserveTriageDecision(db, { userId: input.userId, prospectId: linked.signal.prospectId,
      conversationId: linked.conversation.id, inputMessageId: linked.message.id, contextFingerprint: fingerprint,
      decisionType: DecisionType.INBOUND_TRIAGE, shadowMode: true, supersedesDecisionId }, input.activationPreview === true);
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const existing = await db.decision.findUnique({ where: { userId_inputMessageId_decisionType_contextFingerprint: key }, include: { trace: true } });
    if (!existing) throw error;
    return { status: existing.status, decision: existing, reused: true };
  }

  return analyzeAndFinalizeReservedTriage({userId:input.userId,linked,context,pending,fingerprint},deps);
}

/** Shared canonical C/D/E. Recovery supplies an existing reservation; this function never reserves.
 * Strict recovery leaves PENDING intact if provider/validation/usage recording fails. */
export async function analyzeAndFinalizeReservedTriage(input:{userId:string;
  linked:Awaited<ReturnType<typeof getInboundConversationMessage>>;
  context:Awaited<ReturnType<typeof buildReplyDecisionContext>>;
  pending:{id:string};fingerprint:string;strictRecovery?:boolean},deps:TriageDependencies={}) {
  const db=deps.db??prisma;
  const provider=deps.provider??selectTriageProvider();
  const providerName=provider.provider??'GEMINI';let model=provider.model??TRIAGE_MODEL;
  const {linked,context,pending,fingerprint}=input;
  if(!linked.message||!linked.conversation||!linked.signal.prospectId)throw new Error('RESERVED_DECISION_INPUT_REQUIRED');
  const fast = input.strictRecovery ? null : deterministicTriageSignal(linked.signal);
  let analysis: TriageAnalysis | null = null;
  let source: Source = fast ? Source.DETERMINISTIC : Source.UNAVAILABLE;
  let failure: string | null = null;
  let failureClass:TriageFailureClass|null=null;
  let providerPhase:'PROVIDER'|'VALIDATION'='PROVIDER';
  let providerStarted = false;
  let usage: AIUsageTokens | null = null;
  let latencyMs = 0;
  if (fast) {
    analysis = { primaryIntent: fast.intent, intents: [{ intent: fast.intent, confidence: 100,
      evidence: fast.explanation }], overallConfidence: 100, conciseInterpretation: fast.explanation,
      recommendedNextAction: fast.action, suggestedReply: null, explanation: fast.explanation };
  } else {
    const start = Date.now();
    try {
      const raw = await provider.analyze({ contextText: context.contextText }, {
        onRequestStart: () => { providerStarted = true; }, onResponse: tokens => { usage = tokens; } });
      providerPhase='VALIDATION';
      analysis = validateTriageOutput(raw, context.currentReply);
      source = providerName==='ANTHROPIC'?Source.ANTHROPIC:Source.GEMINI;
    } catch (error) {
      failureClass=classifyTriageFailure(error,providerPhase);
      console.error('[TRIAGE_FAILURE]',JSON.stringify({failureClass,
        ...(failureClass==='PROVIDER_4XX'||failureClass==='PROVIDER_5XX'?{providerDiagnostic:safeGoogleDiagnostic(error)}:{})}));
      failure = error instanceof TypeError || error instanceof SyntaxError ? 'INVALID_MODEL_OUTPUT' : 'MODEL_UNAVAILABLE';
    } finally {
      model=provider.model??model;
      latencyMs = Math.max(0, Date.now() - start);
      if (providerStarted) try { await (deps.recordUsage ?? recordAIUsage)({ userId: input.userId,
        prospectId: linked.signal.prospectId, companyKey: context.companyKey,
        feature: AIFeature.INBOX_TRIAGE, operation: AIOperation.TRIAGE_ANALYSIS,
        provider: providerName==='ANTHROPIC'?AIProvider.ANTHROPIC:AIProvider.GEMINI, model, usage, status: failure ? AIUsageStatus.FAILED : AIUsageStatus.SUCCESS,
        latencyMs }, db); } catch {
        console.error('Inbox triage usage recording failed');
        failure = 'USAGE_RECORDING_FAILED';
        failureClass='USAGE_RECORDING_FAILED';
      }
    }
  }
  if(input.strictRecovery && failureClass)return {status:'STOPPED' as const,decision:null,failureClass,reused:false};

  const policyResults: Awaited<ReturnType<typeof evaluateSalesConstitution>>[] = [];
  const policyActions: string[] = [];
  const evaluate = deps.evaluatePolicy ?? evaluateSalesConstitution;
  const constitutionFacts = buildSalesConstitutionFacts({ qualificationStatus: context.icp?.qualification,
    fitTier: context.icp?.fitTier, primaryIntent: analysis?.primaryIntent,
    secondaryIntents: analysis?.intents.filter(v => v.intent !== analysis?.primaryIntent).map(v => v.intent),
    confidence: analysis?.overallConfidence, jobTitle: context.account?.contactRole,
    industry: context.account?.industry, country: context.account?.country,
    companySizeMin: context.account?.companySizeMin, companySizeMax: context.account?.companySizeMax });
  const intents = analysis?.intents.map(v => v.intent) ?? [];
  const topics = [...new Map(intents.map(intent => topicFor(intent)).filter((v): v is NonNullable<typeof v> => Boolean(v))
    .map(v => [v.category, v])).values()].slice(0, 3);
  try {
    if (topics.length) for (const topic of topics) {
      policyActions.push(`TOPIC_RESPONSE:${topic.category}`);
      policyResults.push(await evaluate({ userId: input.userId,
        action: { actionType: 'TOPIC_RESPONSE', topic: topic.category, scope: topic.scope, facts: constitutionFacts } }, db));
    } else {
      policyActions.push('TOPIC_RESPONSE');
      policyResults.push(await evaluate({ userId: input.userId,
        action: { actionType: 'TOPIC_RESPONSE', scope: Scope.REPLY_DECISION, facts: constitutionFacts } }, db));
    }
    if (analysis?.suggestedReply) {
      policyActions.push('CLAIM');
      policyResults.push(await evaluate({ userId: input.userId,
        action: { actionType: 'CLAIM', proposedClaim: analysis.suggestedReply, scope: Scope.REPLY_DECISION, facts: constitutionFacts } }, db));
    }
    if (analysis?.recommendedNextAction !== 'NO_SALES_OUTREACH') {
      policyActions.push('OUTREACH');
      policyResults.push(await evaluate({ userId: input.userId,
        action: { actionType: 'OUTREACH', scope: Scope.OUTBOUND, facts: constitutionFacts } }, db));
    }
    if (fast?.intent === Intent.UNSUBSCRIBE) {
      policyActions.push('OUTREACH:UNSUBSCRIBE_CONFIRMED');
      policyResults.push(await evaluate({ userId: input.userId,
        action: { actionType: 'OUTREACH', scope: Scope.OUTBOUND, unsubscribeConfirmed: true, facts: constitutionFacts } }, db));
    }
  } catch {
    console.error('Inbox triage Constitution evaluation failed');
    failure = 'POLICY_EVALUATION_FAILED';
    policyResults.length = 0;
    policyActions.length = 0;
  }
  if (!policyResults.length) failure = failure ?? 'POLICY_EVALUATION_FAILED';
  if(input.strictRecovery && (failure || policyResults.some(p=>p.authority!=='SALES_CONSTITUTION'||p.revision!==context.constitution.revision||p.configurationMissing)))
    throw new Error('RECOVERY_POLICY_VERIFICATION_FAILED');
  const reasons = decideReview({ analysis, policy: policyResults, failure });
  const blocked = !policyResults.length || policyResults.some(p => p.blockingRules.length);
  const policyConstrained = blocked || policyResults.some(p => !p.allowed);
  const suggestedReply = policyConstrained ? null : analysis?.suggestedReply ?? null;
  const status = reasons.length ? Status.NEEDS_REVIEW : Status.READY;
  const explanation = cap(analysis?.explanation ?? 'Intent could not be safely resolved; human review is required.', 500);
  const policy = policyResults.map((result, index) => ({ action: policyActions[index], ...policySnapshot(result) }));
  const finalRecommendation = blocked ? 'NO_SALES_OUTREACH' : policyConstrained ? 'ESCALATE_TO_HUMAN' :
    analysis?.recommendedNextAction ?? 'REVIEW_MANUALLY';
  const packet = { status, source, primaryIntent: analysis?.primaryIntent ?? null,
    secondaryIntents: analysis?.intents.filter(v => v.intent !== analysis?.primaryIntent).map(v => v.intent) ?? [],
    intentSignals: analysis?.intents ?? null, confidenceScore: analysis?.overallConfidence ?? null,
    interpretation: analysis?.conciseInterpretation ?? null, recommendedNextAction: finalRecommendation,
    suggestedReply, requiresReview: status !== Status.READY, reviewReasons: reasons, explanation,
    provider: source === Source.ANTHROPIC ? AIProvider.ANTHROPIC : source === Source.GEMINI ? AIProvider.GEMINI : null,
    model: source === Source.GEMINI || source === Source.ANTHROPIC ? model : null };
  // The nested Decision relation supplies its composite userId/decisionId keys.
  // Prisma's CreateWithoutDecision input rejects an explicit userId here.
  const trace = { inputMessageId: linked.message.id, contextFingerprint: fingerprint,
    memoryState: { eventCount: context.memory.eventCount, lastEventAt: context.memory.lastEventAt?.toISOString() ?? null,
      eventIds: context.references.memoryEventIds }, icpState: context.icp,
    brainRevision: context.brain.revision, playbookRevision: context.playbook.revision,
    constitutionRevision: context.constitution.revision, intentOutput: analysis ? {
      primaryIntent: analysis.primaryIntent, intents: analysis.intents, confidence: analysis.overallConfidence } : null,
    policyResult: policy, playbookRuleIds: context.references.playbookRuleIds,
    brainEntryIds: context.references.brainEntryIds, contextReferences: context.references,
    engineVersion: DECISION_ENGINE_VERSION, explanation };
  // Only a PENDING claim is finalized. Completed decisions are never rewritten.
  const completed = await db.decision.update({ where: { id: pending.id, userId: input.userId, status:Status.PENDING, trace:{is:null} }, data: {
    ...packet, intentSignals: packet.intentSignals ?? undefined,
    trace: { create: { ...trace, memoryState: trace.memoryState as Prisma.InputJsonValue,
      icpState: trace.icpState as Prisma.InputJsonValue, intentOutput: trace.intentOutput ?? undefined,
      policyResult: trace.policyResult as Prisma.InputJsonValue,
      contextReferences: trace.contextReferences as Prisma.InputJsonValue } } }, include: { trace: true } });
  if(db===prisma && process.env.CUSTOMER_LIFECYCLE_BRIDGE_SECRET){
    const {projectCustomerProgress}=await import('../customer-lifecycle');
    await projectCustomerProgress(input.userId);
  }
  return { status: completed.status, decision: completed, reused: false };
}
