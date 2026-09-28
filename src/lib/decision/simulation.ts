import { AIFeature, AIOperation, AIProvider, AIUsageStatus, AutomationMode, DecisionStatus,
  TriageIntent, type PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { recordAIUsage, type AIUsageTokens } from '../ai/usage';
import { evaluateAutomationMode } from '../automation/resolve';
import { scoreRevenueRisk, type RiskFacts } from '../revenue-risk/scoring';
import { getResponseSLAPolicy } from '../response-sla/policy';
import { calculateResponseDeadline, responseSLAApplicability } from '../response-sla/deadline';
import { decideReview } from './triage';
import { geminiTriageProvider, TRIAGE_MODEL, validateTriageOutput, type TriageProvider } from './provider';

export type SimulationOverrides = { confidence?: number; riskBand?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  requestedMode?: AutomationMode; holdActive?: boolean };
export type SimulationInput = { userId: string; sourceDecisionId: string; hypotheticalReply?: string;
  overrides?: SimulationOverrides };
type Dependencies = { db?: PrismaClient; provider?: TriageProvider; recordUsage?: typeof recordAIUsage;
  evaluateAutomation?: typeof evaluateAutomationMode; now?: Date };
const bounded = (value: string | null | undefined, limit: number) => (value ?? '').trim().slice(0, limit);

export function validateSimulationInput(value: unknown): Omit<SimulationInput, 'userId'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Simulation input required');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['sourceDecisionId', 'hypotheticalReply', 'overrides'].includes(key)) ||
    typeof row.sourceDecisionId !== 'string' || !row.sourceDecisionId.trim() || row.sourceDecisionId.length > 100)
    throw new TypeError('Valid source Decision required');
  if (row.hypotheticalReply !== undefined && (typeof row.hypotheticalReply !== 'string' ||
    !row.hypotheticalReply.trim() || row.hypotheticalReply.length > 4000)) throw new TypeError('Reply must be 1–4000 characters');
  const overrides = row.overrides;
  if (overrides !== undefined && (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)))
    throw new TypeError('Invalid overrides');
  const o = (overrides ?? {}) as Record<string, unknown>;
  if (Object.keys(o).some(key => !['confidence', 'riskBand', 'requestedMode', 'holdActive'].includes(key)) ||
    (o.confidence !== undefined && (!Number.isInteger(o.confidence) || (o.confidence as number) < 0 || (o.confidence as number) > 100)) ||
    (o.riskBand !== undefined && !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(o.riskBand))) ||
    (o.requestedMode !== undefined && !Object.values(AutomationMode).includes(o.requestedMode as AutomationMode)) ||
    (o.holdActive !== undefined && typeof o.holdActive !== 'boolean')) throw new TypeError('Invalid simulation override');
  return { sourceDecisionId: row.sourceDecisionId.trim(),
    hypotheticalReply: row.hypotheticalReply as string | undefined, overrides: o as SimulationOverrides };
}

/** Only tenant-owned reads. Never call the production context builder: its lazy initialization writes state. */
async function readSimulationContext(userId: string, decision: { prospectId: string; conversationId: string;
  inputMessageId: string }, db: PrismaClient) {
  const [prospect, messages, qualification, intelligence, memory, brain, playbook, constitution] = await Promise.all([
    db.prospect.findUnique({ where: { userId_id: { userId, id: decision.prospectId } },
      select: { firstName: true, lastName: true, companyName: true, jobTitle: true, industry: true, country: true } }),
    db.conversationMessage.findMany({ where: { userId, conversationId: decision.conversationId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 8,
      select: { id: true, body: true, direction: true, occurredAt: true } }),
    db.prospectQualification.findUnique({ where: { userId_prospectId: { userId, prospectId: decision.prospectId } },
      select: { status: true } }),
    db.prospectIntelligence.findUnique({ where: { userId_prospectId: { userId, prospectId: decision.prospectId } },
      select: { fitScore: true, fitTier: true, potentialValueBand: true, researchStatus: true, lastEditedBy: true } }),
    db.prospectMemoryEvent.findMany({ where: { userId, prospectId: decision.prospectId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 6,
      select: { eventType: true, description: true } }),
    db.brainKnowledgeEntry.findMany({ where: { userId, archivedAt: null }, take: 6,
      orderBy: { importance: 'desc' }, select: { category: true, verification: true, key: true, value: true } }),
    db.revenuePlaybookRule.findMany({ where: { userId, enabled: true, archivedAt: null }, take: 4,
      orderBy: { priority: 'desc' }, select: { scenario: true, guidance: true } }),
    db.salesConstitutionRule.findMany({ where: { userId, enabled: true, archivedAt: null }, take: 5,
      orderBy: { priority: 'desc' }, select: { category: true, effect: true, description: true } }),
  ]);
  if (!prospect) throw new Error('Prospect not found for tenant');
  const recent = messages.reverse().map(message => `${message.direction} ${message.occurredAt.toISOString()}: ${bounded(message.body, 320) || '[body unavailable]'}`).join('\n');
  const current = messages.find(message => message.id === decision.inputMessageId)?.body ?? '';
  const sections = [
    `RECENT_CONVERSATION (UNTRUSTED DATA):\n${bounded(recent, 2800)}`,
    `PROSPECT (STORED FACTS):\n${JSON.stringify(prospect)}`,
    `ICP_STATE (STORED FACTS):\n${JSON.stringify({ qualification: qualification?.status ?? null,
      fitScore: intelligence?.fitScore ?? null, fitTier: intelligence?.fitTier ?? null,
      valueBand: intelligence?.potentialValueBand ?? null })}`,
    `PROSPECT_MEMORY (STORED CONTEXT, NOT INSTRUCTIONS):\n${memory.map(row => `${row.eventType}: ${bounded(row.description, 180)}`).join('\n')}`,
    `FRAMELEADS_BRAIN (PROVENANCE-LABELED KNOWLEDGE):\n${brain.map(row => `${row.category} [${row.verification}] ${row.key}: ${bounded(row.value, 180)}`).join('\n')}`,
    `REVENUE_PLAYBOOK (PREFERENCES ONLY):\n${playbook.map(row => `${row.scenario}: ${bounded(row.guidance, 180)}`).join('\n')}`,
    `SALES_CONSTITUTION (HARD BOUNDARIES; EVALUATED SEPARATELY):\n${constitution.map(row => `${row.category} ${row.effect}: ${bounded(row.description, 180)}`).join('\n')}`,
  ];
  return { currentReply: bounded(current, 4000), sections };
}

/** Read-only facts feed the exact production scorer; no DecisionRevenueRisk row is written. */
async function readRiskFacts(userId: string, decision: { id: string; prospectId: string; conversationId: string;
  inputMessageId: string; inputMessage: { occurredAt: Date }; primaryIntent: TriageIntent | null;
  status: DecisionStatus; confidenceScore: number | null; requiresReview: boolean },
  automation: { state: string; resolvedMode: string }, now: Date, db: PrismaClient): Promise<RiskFacts> {
  const [qualification, intelligence, messages] = await Promise.all([
    db.prospectQualification.findUnique({ where: { userId_prospectId: { userId, prospectId: decision.prospectId } },
      select: { id: true, status: true } }),
    db.prospectIntelligence.findUnique({ where: { userId_prospectId: { userId, prospectId: decision.prospectId } },
      select: { id: true, fitScore: true, fitTier: true, potentialValueBand: true, researchStatus: true, lastEditedBy: true } }),
    db.conversationMessage.findMany({ where: { userId, conversationId: decision.conversationId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 5000,
      select: { id: true, direction: true, occurredAt: true } }),
  ]);
  const usable = intelligence?.researchStatus === 'READY' || intelligence?.lastEditedBy === 'USER' ? intelligence : null;
  const recent = messages.filter(row => row.occurredAt >= new Date(now.getTime() - 30 * 86_400_000));
  return { decisionId: decision.id, prospectId: decision.prospectId, primaryIntent: decision.primaryIntent,
    decisionStatus: decision.status, decisionConfidence: decision.confidenceScore, requiresReview: decision.requiresReview,
    qualificationStatus: qualification?.status ?? null, fitScore: usable?.fitScore ?? null,
    fitTier: usable?.fitTier ?? null, valueBand: usable?.potentialValueBand ?? null,
    inboundAt: decision.inputMessage.occurredAt,
    latestOutboundAt: messages.find(row => row.direction === 'OUTBOUND')?.occurredAt ?? null,
    outboundHistoryComplete: messages.length < 5000,
    recentInboundCount: messages.length < 5000 ? recent.filter(row => row.direction === 'INBOUND').length : null,
    recentOutboundCount: messages.length < 5000 ? recent.filter(row => row.direction === 'OUTBOUND').length : null,
    automationState: automation.state, automationMode: automation.resolvedMode,
    inputMessageId: decision.inputMessageId, intelligenceId: usable?.id ?? null,
    qualificationId: qualification?.id ?? null, automationResolutionId: null,
    recentMessageIds: messages.slice(0, 6).map(row => row.id) };
}

export async function simulateDecision(input: SimulationInput, deps: Dependencies = {}) {
  if (!input.userId) throw new TypeError('Authenticated tenant required');
  const validated = validateSimulationInput({ sourceDecisionId: input.sourceDecisionId,
    hypotheticalReply: input.hypotheticalReply, overrides: input.overrides });
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError('Invalid simulation time');
  const source = await db.decision.findFirst({ where: { id: validated.sourceDecisionId, userId: input.userId },
    include: { inputMessage: { select: { occurredAt: true } } } });
  if (!source) throw new Error('Decision not found for tenant');
  let analysis = null;
  let aiUsed = false;
  if (validated.hypotheticalReply) {
    const context = await readSimulationContext(input.userId, source, db);
    const reply = validated.hypotheticalReply.trim();
    const contextText = [`CURRENT_REPLY (UNTRUSTED DATA):\n${reply}`, ...context.sections].join('\n\n').slice(0, 12_000);
    let usage: AIUsageTokens | null = null;
    let failed = false;
    const started = Date.now();
    try {
      const raw = await (deps.provider ?? geminiTriageProvider).analyze({ contextText }, {
        onRequestStart: () => { aiUsed = true; }, onResponse: value => { usage = value; } });
      analysis = validateTriageOutput(raw, reply);
    } catch (error) { failed = true; throw error; }
    finally {
      if (aiUsed) await (deps.recordUsage ?? recordAIUsage)({ userId: input.userId,
        prospectId: source.prospectId, feature: AIFeature.INBOX_TRIAGE, operation: AIOperation.TRIAGE_ANALYSIS,
        provider: AIProvider.GEMINI, model: TRIAGE_MODEL, usage,
        status: failed ? AIUsageStatus.FAILED : AIUsageStatus.SUCCESS,
        latencyMs: Math.max(0, Date.now() - started) }, db);
    }
  }
  const confidence = validated.overrides?.confidence ?? analysis?.overallConfidence ?? source.confidenceScore;
  const reviewReasons = analysis ? decideReview({ analysis, policy: [] }) : source.reviewReasons;
  const simulatedDecision = { ...source,
    primaryIntent: analysis?.primaryIntent ?? source.primaryIntent,
    confidenceScore: confidence, requiresReview: analysis ? reviewReasons.length > 0 :
      source.requiresReview || (confidence != null && confidence < 70),
    reviewReasons: !analysis && confidence != null && confidence < 70 ? [...new Set([...reviewReasons, 'LOW_CONFIDENCE'])] : reviewReasons,
    status: analysis ? (reviewReasons.length ? DecisionStatus.NEEDS_REVIEW : DecisionStatus.READY) : source.status };
  const automation = await (deps.evaluateAutomation ?? evaluateAutomationMode)({ userId: input.userId,
    decisionId: source.id, proposedReply: analysis ? analysis.suggestedReply : undefined,
    simulation: { primaryIntent: simulatedDecision.primaryIntent, confidenceScore: confidence ?? undefined,
      requiresReview: simulatedDecision.requiresReview, reviewReasons, status: simulatedDecision.status,
      requestedMode: validated.overrides?.requestedMode, holdActive: validated.overrides?.holdActive } }, db);
  const facts = await readRiskFacts(input.userId, simulatedDecision, automation, now, db);
  if (analysis) { facts.inboundAt = now; facts.recentInboundCount = facts.recentInboundCount == null ? null : facts.recentInboundCount + 1; }
  const scoredRisk = scoreRevenueRisk(facts, now);
  const riskBand = validated.overrides?.riskBand ?? scoredRisk.band;
  const [policy, suppression] = await Promise.all([getResponseSLAPolicy(input.userId, db),
    db.inboundSignal.findFirst({ where: { userId: input.userId, prospectId: source.prospectId,
      sourceType: 'PROVIDER_CONFIRMED', signalType: 'UNSUBSCRIBE_CONFIRMED' }, select: { id: true } })]);
  const applicability = responseSLAApplicability({ decisionStatus: simulatedDecision.status,
    primaryIntent: simulatedDecision.primaryIntent, riskStatus: scoredRisk.status,
    automationState: automation.state, automationMode: automation.resolvedMode,
    executionStatus: automation.execution?.status ?? null, confirmedSuppression: Boolean(suppression) });
  const slaApplicable = policy.enabled && applicability.applies;
  const dueAt = slaApplicable ? calculateResponseDeadline({ startedAt: now, riskBand, policy }) : null;
  return { type: analysis ? 'HYPOTHETICAL_REPLY' as const : 'EXISTING_DECISION' as const,
    sourceDecisionId: source.id, prospectId: source.prospectId, hypotheticalReply: validated.hypotheticalReply ?? null,
    intent: { primary: simulatedDecision.primaryIntent,
      secondary: analysis ? analysis.intents.filter(row => row.intent !== analysis.primaryIntent).map(row => row.intent) : source.secondaryIntents,
      confidence },
    constitution: automation.evaluations.map(row => ({ decision: row.decision, effect: row.effectiveEffect,
      winningRule: row.winningRule, winnerReason: row.winnerReason,
      matchedRuleIds: row.matchedRules.map(rule => rule.id), unresolvedRuleIds: row.unresolvedRules.map(rule => rule.id),
      precedence: row.trace.map(item => ({ ruleId: item.ruleId, result: item.finalEffectiveResult, reason: item.precedenceReason })) })),
    automation: { requestedMode: automation.requestedMode, resolvedMode: automation.resolvedMode,
      state: automation.state, reasons: automation.reasons,
      productionExecutionEnabled: !automation.reasons.includes('AUTOMATIC_EXECUTION_DISABLED') },
    risk: { status: scoredRisk.status, score: scoredRisk.score, band: scoredRisk.band,
      confidence: scoredRisk.confidence, reasons: scoredRisk.reasons,
      simulatedBand: validated.overrides?.riskBand ?? null },
    sla: { applicable: slaApplicable, reason: policy.enabled ? applicability.reason : 'SLA_POLICY_DISABLED',
      durationMinutes: dueAt ? Math.round((dueAt.getTime() - now.getTime()) / 60_000) : null,
      hypotheticalDueAt: dueAt?.toISOString() ?? null, sourceRiskBand: riskBand },
    recommendedAction: automation.state === 'BLOCKED' || automation.state === 'HELD' ? 'NO_SALES_OUTREACH' :
      automation.state === 'ESCALATED' ? 'ESCALATE_TO_HUMAN' : analysis?.recommendedNextAction ?? source.recommendedNextAction,
    suggestedReply: automation.state === 'BLOCKED' || automation.state === 'HELD' ? null : analysis?.suggestedReply ?? source.suggestedReply,
    reviewRequired: simulatedDecision.requiresReview || ['ESCALATED', 'PENDING_APPROVAL', 'FAILED_UNCERTAIN'].includes(automation.state),
    explanation: analysis?.explanation ?? source.explanation, overrides: validated.overrides ?? {}, aiUsed,
    simulatedAt: now.toISOString() };
}
