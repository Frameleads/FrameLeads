import type { TriageIntent } from '@prisma/client';

export const REVENUE_RISK_VERSION = 'revenue-risk-v1';
export const COMPONENT_WEIGHTS = Object.freeze({ opportunity: 20, icp: 20, intent: 20,
  delay: 15, momentum: 10, uncertainty: 8, governance: 7 });
export const BAND_THRESHOLDS = Object.freeze({ CRITICAL: 80, HIGH: 60, MEDIUM: 35 });
const INTENT_SCORES: Partial<Record<TriageIntent, number>> = {
  MEETING_REQUEST: 95, PROCUREMENT: 90, NEGOTIATION: 90, PRICING_INQUIRY: 85,
  POSITIVE_INTEREST: 80, REFERRAL: 70, PRICING_OBJECTION: 65, BUDGET_OBJECTION: 60,
  SECURITY: 55, LEGAL: 55, COMPLIANCE: 55, INTEGRATION_QUESTION: 50,
  FEATURE_QUESTION: 45, FEATURE_GAP: 45, TIMING_OBJECTION: 45,
  COMPETITOR_OBJECTION: 45, TRUST_OBJECTION: 40, NEUTRAL_QUESTION: 30,
  CONFUSED: 25, OTHER: 25, EXISTING_CUSTOMER: 40,
};
const NON_REVENUE_INTENTS = new Set<TriageIntent>(['SPAM', 'OUT_OF_OFFICE', 'UNSUBSCRIBE',
  'WRONG_PERSON', 'NOT_INTERESTED'] as TriageIntent[]);
const VALUE_TIER_SCORES: Record<string, number> = { LOW: 25, MEDIUM: 50, HIGH: 75, STRATEGIC: 95 };
const FIT_TIER_SCORES: Record<string, number> = { STRONG: 85, MODERATE: 55, WEAK: 25, DISQUALIFIED: 5 };
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export type RiskSignal = keyof typeof COMPONENT_WEIGHTS;
export type RiskComponent = { signal: RiskSignal; value: string | number | null;
  normalizedScore: number | null; weight: number; contribution: number | null;
  source: string | null; known: boolean; reason: string | null };
export type RiskFacts = {
  decisionId: string; prospectId: string; primaryIntent: TriageIntent | null;
  decisionStatus: string; decisionConfidence: number | null; requiresReview: boolean;
  qualificationStatus: string | null; fitScore: number | null; fitTier: string | null;
  valueBand: string | null; inboundAt: Date | null; latestOutboundAt: Date | null;
  outboundHistoryComplete: boolean;
  recentInboundCount: number | null; recentOutboundCount: number | null;
  automationState: string | null; automationMode: string | null;
  inputMessageId: string; intelligenceId: string | null; qualificationId: string | null;
  automationResolutionId: string | null;
  recentMessageIds: string[];
};

/** Pure prioritization index. Unknown components leave the denominator; no dollar amount is inferred. */
export function scoreRevenueRisk(facts: RiskFacts, now = new Date()) {
  const sources = [
    { type: 'DECISION', id: facts.decisionId }, { type: 'CONVERSATION_MESSAGE', id: facts.inputMessageId },
    ...(facts.intelligenceId ? [{ type: 'PROSPECT_INTELLIGENCE', id: facts.intelligenceId }] : []),
    ...(facts.qualificationId ? [{ type: 'PROSPECT_QUALIFICATION', id: facts.qualificationId }] : []),
    ...(facts.automationResolutionId ? [{ type: 'AUTOMATION_RESOLUTION', id: facts.automationResolutionId }] : []),
    ...facts.recentMessageIds.slice(0, 6).map(id => ({ type: 'CONVERSATION_MESSAGE', id })),
  ];
  if (facts.primaryIntent && NON_REVENUE_INTENTS.has(facts.primaryIntent)) return {
    status: facts.decisionStatus === 'READY' && !facts.requiresReview && (facts.decisionConfidence ?? 0) >= 70 ?
      'NOT_APPLICABLE' as const : 'INSUFFICIENT_DATA' as const,
    score: null, band: null, confidence: facts.decisionStatus === 'READY' && (facts.decisionConfidence ?? 0) >= 70 ?
      'HIGH' as const : 'LOW' as const,
    components: [] as RiskComponent[], reasons: [facts.requiresReview || (facts.decisionConfidence ?? 0) < 70 ?
      'Non-revenue classification needs human review.' : `${facts.primaryIntent.replaceAll('_', ' ')} is not an active revenue opportunity.`],
    sourceReferences: sources, scoringVersion: REVENUE_RISK_VERSION,
  };
  if (['EXECUTED', 'REJECTED'].includes(facts.automationState ?? '')) return {
    status: 'NOT_APPLICABLE' as const, score: null, band: null, confidence: 'HIGH' as const,
    components: [] as RiskComponent[], reasons: ['This Decision has no pending revenue action.'],
    sourceReferences: sources, scoringVersion: REVENUE_RISK_VERSION,
  };
  const components: RiskComponent[] = [];
  const add = (signal: RiskSignal, value: string | number | null, normalizedScore: number | null,
    source: string | null, reason: string | null) => {
    const known = normalizedScore !== null;
    const weight = COMPONENT_WEIGHTS[signal];
    components.push({ signal, value, normalizedScore: known ? clamp(normalizedScore) : null, weight,
      contribution: known ? Math.round(clamp(normalizedScore) * weight / 100) : null, source, known, reason: known ? reason : null });
  };
  const valueScore = facts.valueBand ? VALUE_TIER_SCORES[facts.valueBand] ?? null : null;
  add('opportunity', facts.valueBand, valueScore, facts.intelligenceId ? 'PROSPECT_INTELLIGENCE' : null,
    facts.valueBand ? `Estimated opportunity tier: ${facts.valueBand}.` : null);
  const icpScore = facts.qualificationStatus === 'REJECTED' ? 5 :
    facts.fitScore != null && Number.isFinite(facts.fitScore) ? clamp(facts.fitScore) :
      facts.fitTier ? FIT_TIER_SCORES[facts.fitTier] ?? null :
        facts.qualificationStatus === 'QUALIFIED' ? 75 : null;
  add('icp', facts.fitScore ?? facts.fitTier ?? facts.qualificationStatus, icpScore,
    facts.intelligenceId ? 'PROSPECT_INTELLIGENCE' : facts.qualificationId ? 'PROSPECT_QUALIFICATION' : null,
    icpScore == null ? null : facts.qualificationStatus === 'REJECTED' ? 'Deterministic ICP qualification rejected this prospect.' :
      icpScore >= 70 ? 'Strong recorded ICP alignment.' : 'Recorded ICP alignment is limited.');
  const intentScore = facts.primaryIntent ? INTENT_SCORES[facts.primaryIntent] ?? null : null;
  add('intent', facts.primaryIntent, intentScore, 'DECISION', intentScore == null ? null :
    intentScore >= 70 ? `Commercial signal: ${facts.primaryIntent!.replaceAll('_', ' ')}.` :
      `Conversation intent: ${facts.primaryIntent!.replaceAll('_', ' ')}.`);
  const waiting = facts.inboundAt && (!facts.latestOutboundAt || facts.latestOutboundAt < facts.inboundAt);
  const elapsedHours = facts.inboundAt ? Math.max(0, (now.getTime() - facts.inboundAt.getTime()) / 3_600_000) : null;
  const delayScore = elapsedHours == null || !facts.outboundHistoryComplete ? null : !waiting ? 5 : elapsedHours < 1 ? 15 :
    elapsedHours < 6 ? 35 : elapsedHours < 24 ? 55 : elapsedHours < 72 ? 75 : 90;
  const delayBucket = elapsedHours == null ? null : !waiting ? 'RESPONDED' : elapsedHours < 1 ? 'UNDER_1_HOUR' :
    elapsedHours < 6 ? '1_TO_6_HOURS' : elapsedHours < 24 ? '6_TO_24_HOURS' :
      elapsedHours < 72 ? '24_TO_72_HOURS' : 'OVER_72_HOURS';
  add('delay', delayScore == null ? null : delayBucket, delayScore, 'CONVERSATION_MESSAGE',
    delayScore == null ? null : waiting ? `Awaiting response: ${delayBucket!.replaceAll('_', ' ').toLowerCase()}.` :
      'A later outbound response is recorded.');
  const inboundCount = facts.recentInboundCount, outboundCount = facts.recentOutboundCount;
  const momentumScore = inboundCount == null || outboundCount == null ? null :
    inboundCount >= 2 && outboundCount >= 1 ? 85 : inboundCount >= 2 ? 65 :
      inboundCount >= 1 && outboundCount >= 1 ? 70 : inboundCount >= 1 ? 40 : 15;
  add('momentum', momentumScore == null ? null : `${inboundCount} inbound / ${outboundCount} outbound`,
    momentumScore, 'CONVERSATION_MESSAGE', momentumScore == null ? null :
      momentumScore >= 70 ? 'Recent reciprocal conversation activity.' : 'Limited recent conversation activity.');
  const uncertaintyScore = facts.decisionConfidence == null ? null :
    facts.requiresReview || facts.decisionStatus === 'NEEDS_REVIEW' ? 85 : clamp(100 - facts.decisionConfidence);
  add('uncertainty', facts.decisionConfidence, uncertaintyScore, 'DECISION', uncertaintyScore == null ? null :
    facts.requiresReview || facts.decisionStatus === 'NEEDS_REVIEW' ? 'Decision needs human review.' :
      uncertaintyScore >= 40 ? 'Decision confidence is limited.' : 'Decision confidence is high.');
  const governanceScore = facts.automationState == null ? null :
    facts.automationState === 'ESCALATED' ? 90 : facts.automationState === 'PENDING_APPROVAL' ? 75 :
      facts.automationState === 'READY' ? 35 : facts.automationState === 'REANALYSIS_REQUIRED' ? 80 :
        facts.automationState === 'FAILED_UNCERTAIN' ? 90 : 25;
  add('governance', facts.automationState, governanceScore,
    facts.automationResolutionId ? 'AUTOMATION_RESOLUTION' : null,
    governanceScore == null ? null : governanceScore >= 75 ? 'Human or governed action is pending.' :
      'No immediate human governance action is recorded.');
  const known = components.filter(component => component.known);
  const coverage = known.reduce((sum, component) => sum + component.weight, 0);
  if (!coverage) return { status: 'INSUFFICIENT_DATA' as const, score: null, band: null,
    confidence: 'LOW' as const, components, reasons: ['Insufficient recorded signals to rank this conversation.'],
    sourceReferences: sources, scoringVersion: REVENUE_RISK_VERSION };
  const score = clamp(known.reduce((sum, component) => sum + component.normalizedScore! * component.weight, 0) / coverage);
  const band = score >= BAND_THRESHOLDS.CRITICAL ? 'CRITICAL' as const :
    score >= BAND_THRESHOLDS.HIGH ? 'HIGH' as const : score >= BAND_THRESHOLDS.MEDIUM ? 'MEDIUM' as const : 'LOW' as const;
  const confidence = coverage >= 75 && facts.decisionConfidence != null && facts.decisionConfidence >= 70 && !facts.requiresReview ? 'HIGH' as const :
    coverage >= 45 ? 'MEDIUM' as const : 'LOW' as const;
  const reasons = known.filter(component => component.reason && component.normalizedScore! >= 50)
    .sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0) || a.signal.localeCompare(b.signal))
    .slice(0, 4).map(component => component.reason!);
  if (!reasons.length) reasons.push('Available signals indicate limited immediate revenue priority.');
  return { status: 'APPLICABLE' as const, score, band, confidence,
    components, reasons, sourceReferences: sources, scoringVersion: REVENUE_RISK_VERSION };
}
