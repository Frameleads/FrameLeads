import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateDecision, validateSimulationInput } from '../src/lib/decision/simulation';
import { evaluateAutomationMode } from '../src/lib/automation/resolve';
import { scoreRevenueRisk } from '../src/lib/revenue-risk/scoring';
import { calculateResponseDeadline } from '../src/lib/response-sla/deadline';

const tenant = 'tenant-a';
const now = new Date('2026-09-29T12:00:00.000Z');
const reply = 'I would like to discuss pricing.';
const analysis = { primaryIntent: 'PRICING_INQUIRY', intents: [{ intent: 'PRICING_INQUIRY', confidence: 92,
  evidence: 'discuss pricing' }], overallConfidence: 90, conciseInterpretation: 'Pricing interest.',
  recommendedNextAction: 'ASK_CLARIFYING_QUESTION', suggestedReply: 'Which plan interests you?',
  explanation: 'The reply explicitly asks about pricing.' };
function fixture(effect: string | null = null) {
  const writes: string[] = [], usages: any[] = [];
  let providerCalls = 0;
  const decision: any = { id: 'decision-a', userId: tenant, prospectId: 'prospect-a',
    conversationId: 'conversation-a', inputMessageId: 'message-a', primaryIntent: 'POSITIVE_INTEREST',
    secondaryIntents: [], status: 'READY', confidenceScore: 95, requiresReview: false, reviewReasons: [],
    suggestedReply: 'Thanks for your interest.', recommendedNextAction: 'REPLY_WITH_FACTS',
    explanation: 'The prospect is interested.', trace: null,
    inputMessage: { sourceId: 'signal-a', sourceType: 'INBOUND_SIGNAL', occurredAt: new Date('2026-09-29T11:00:00Z') } };
  const rule = effect ? [{ id: 'rule-a', name: 'Rule A', category: 'CLAIM', scope: 'GLOBAL', severity: 'HIGH',
    priority: 1, effect, actionTypes: ['CLAIM'], constraint: { kind: 'PROHIBITED_CLAIM', terms: ['Thanks'] },
    machineEvaluable: true, enabled: true, archivedAt: null }] : [];
  const read = (name: string, methods: Record<string, (...args: any[]) => any>) => new Proxy(methods, {
    get(target, key) { if (typeof key === 'string' && /^(create|update|upsert|delete|createMany|updateMany|deleteMany)$/.test(key))
      return () => { writes.push(`${name}.${key}`); throw new Error(`Forbidden write ${name}.${key}`); };
      return target[key as keyof typeof target]; } });
  const db: any = {
    user: read('user', { findUnique: async ({ where }: any) => where.id === tenant ?
      { id: tenant, imapEmail: 'owner@example.com', imapPassword: 'secret', imapHost: 'imap.example.com' } : null }),
    decision: read('decision', { findFirst: async ({ where }: any) => where.userId === tenant && where.id === decision.id ? decision : null }),
    prospect: read('prospect', { findUnique: async ({ where }: any) => where.userId_id.userId === tenant ?
      { firstName: 'Alex', lastName: 'Lee', companyName: 'Acme', jobTitle: 'VP Sales', industry: 'SaaS', country: 'US' } : null }),
    conversationMessage: read('conversationMessage', { findMany: async () => [
      { id: 'message-a', body: 'We are interested.', direction: 'INBOUND', occurredAt: new Date('2026-09-29T11:00:00Z') } ] }),
    prospectQualification: read('prospectQualification', { findUnique: async () => ({ id: 'qualification-a', status: 'QUALIFIED' }) }),
    prospectIntelligence: read('prospectIntelligence', { findUnique: async () => ({ id: 'intelligence-a', fitScore: 85,
      fitTier: 'STRONG', potentialValueBand: 'HIGH', researchStatus: 'READY', lastEditedBy: null }) }),
    prospectMemoryEvent: read('prospectMemoryEvent', { findMany: async () => [] }),
    brainKnowledgeEntry: read('brainKnowledgeEntry', { findMany: async () => [] }),
    revenuePlaybookRule: read('revenuePlaybookRule', { findMany: async () => [] }),
    salesConstitutionRule: read('salesConstitutionRule', { findMany: async ({ where }: any) => rule.filter(r => r.actionTypes.includes(where.actionTypes.has)) }),
    salesConstitution: read('salesConstitution', { findUnique: async () => ({ id: 'constitution-a', revision: 1 }) }),
    automationPolicy: read('automationPolicy', { findUnique: async () => ({ id: 'policy-a', userId: tenant,
      defaultMode: 'HUMAN_APPROVAL', fallbackMode: 'HUMAN_APPROVAL', autopilotEnabled: false,
      autoExecutionDisabled: true, autopilotMinConfidence: 85, maxAutoSendsPerDay: 10, revision: 1 }) }),
    automationCampaignOverride: read('automationCampaignOverride', { findUnique: async () => null }),
    prospectHold: read('prospectHold', { findUnique: async () => null }),
    inboundSignal: read('inboundSignal', { findFirst: async ({ where }: any) => where.signalType === 'UNSUBSCRIBE_CONFIRMED' ? null :
      { id: 'signal-a', generatedLead: { id: 'lead-a', listId: 'list-a', email: 'alex@example.com' } } }),
    decisionExecutionAttempt: read('decisionExecutionAttempt', { findUnique: async () => null, count: async () => 0 }),
    decisionActionEvent: read('decisionActionEvent', { findFirst: async () => null }),
    frameLeadsBrain: read('frameLeadsBrain', { findUnique: async () => null }),
    revenuePlaybook: read('revenuePlaybook', { findUnique: async () => null }),
    responseSLAPolicy: read('responseSLAPolicy', { findUnique: async () => null }),
    responseSLAInstance: read('responseSLAInstance', {}),
    decisionRevenueRisk: read('decisionRevenueRisk', {}),
    decisionAssignment: read('decisionAssignment', {}),
    outboundLog: read('outboundLog', {}),
    decisionAutomationResolution: read('decisionAutomationResolution', {}),
    aIUsageEvent: read('aIUsageEvent', {}),
  };
  const provider: any = { analyze: async (_request: any, observer: any) => {
    providerCalls++; observer?.onRequestStart(); observer?.onResponse({ inputTokens: 100, outputTokens: 50 }); return analysis; } };
  const recordUsage: any = async (value: any) => { usages.push(value); };
  return { db, provider, recordUsage, writes, usages, providerCalls: () => providerCalls };
}

test('existing Decision reuses production Constitution, automation, risk, and SLA with zero AI and zero writes', async () => {
  const f = fixture();
  const result = await simulateDecision({ userId: tenant, sourceDecisionId: 'decision-a' },
    { db: f.db, provider: f.provider, recordUsage: f.recordUsage, now });
  assert.equal(result.type, 'EXISTING_DECISION'); assert.equal(result.aiUsed, false);
  assert.equal(f.providerCalls(), 0); assert.equal(f.usages.length, 0); assert.deepEqual(f.writes, []);
  assert.equal(result.automation.state, 'PENDING_APPROVAL');
  assert.equal(result.risk.status, 'APPLICABLE');
  assert.equal(result.sla.hypotheticalDueAt, result.sla.applicable ?
    calculateResponseDeadline({ startedAt: now, riskBand: result.sla.sourceRiskBand,
      policy: { criticalMinutes: 15, highMinutes: 60, mediumMinutes: 240, lowMinutes: 1440,
        unknownMinutes: 240, dueSoonPercent: 75 } }).toISOString() : null);
  assert.equal(typeof scoreRevenueRisk, 'function'); assert.equal(typeof evaluateAutomationMode, 'function');
});

test('Constitution BLOCK and REQUIRE_HUMAN remain authoritative in simulation', async () => {
  for (const [effect, state] of [['BLOCK', 'BLOCKED'], ['REQUIRE_HUMAN', 'ESCALATED']]) {
    const f = fixture(effect);
    const result = await simulateDecision({ userId: tenant, sourceDecisionId: 'decision-a',
      overrides: { requestedMode: 'AUTOPILOT' } }, { db: f.db, provider: f.provider, recordUsage: f.recordUsage, now });
    assert.equal(result.automation.state, state);
    assert.ok(result.constitution.some(row => row.matchedRuleIds.includes('rule-a')));
    assert.deepEqual(f.writes, []); assert.equal(f.providerCalls(), 0);
  }
});

test('explicit hypothetical reply calls the production provider at most once and records only real usage', async () => {
  const f = fixture();
  const result = await simulateDecision({ userId: tenant, sourceDecisionId: 'decision-a', hypotheticalReply: reply },
    { db: f.db, provider: f.provider, recordUsage: f.recordUsage, now });
  assert.equal(result.type, 'HYPOTHETICAL_REPLY'); assert.equal(result.intent.primary, 'PRICING_INQUIRY');
  assert.equal(f.providerCalls(), 1); assert.equal(f.usages.length, 1); assert.equal(f.usages[0].userId, tenant);
  assert.deepEqual(f.writes, []);
});

test('tenant boundary and bounded overrides prevent cross-tenant or arbitrary mutation', async () => {
  const f = fixture();
  await assert.rejects(() => simulateDecision({ userId: 'tenant-b', sourceDecisionId: 'decision-a' },
    { db: f.db, provider: f.provider, recordUsage: f.recordUsage, now }), /not found for tenant/);
  assert.throws(() => validateSimulationInput({ sourceDecisionId: 'decision-a', overrides: { userId: 'tenant-b' } }), /Invalid simulation override/);
  assert.throws(() => validateSimulationInput({ sourceDecisionId: 'decision-a', hypotheticalReply: 'x'.repeat(4001) }), /4000/);
  const result = await simulateDecision({ userId: tenant, sourceDecisionId: 'decision-a',
    overrides: { confidence: 45, riskBand: 'CRITICAL', requestedMode: 'AUTOPILOT', holdActive: true } },
    { db: f.db, provider: f.provider, recordUsage: f.recordUsage, now });
  assert.equal(result.intent.confidence, 45); assert.equal(result.automation.state, 'HELD');
  assert.equal(result.sla.sourceRiskBand, 'CRITICAL'); assert.equal(f.providerCalls(), 0);
  assert.deepEqual(f.writes, []);
});

test('invalid model output is rejected and never creates an operational write', async () => {
  const f = fixture();
  await assert.rejects(() => simulateDecision({ userId: tenant, sourceDecisionId: 'decision-a', hypotheticalReply: reply },
    { db: f.db, provider: { analyze: async (_request, observer) => { observer?.onRequestStart(); return { ...analysis,
      intents: [{ ...analysis.intents[0], evidence: 'fabricated evidence' }] }; } },
      recordUsage: f.recordUsage, now }), /evidence is not in the reply/);
  assert.equal(f.usages.length, 1); assert.equal(f.usages[0].status, 'FAILED'); assert.deepEqual(f.writes, []);
});
