import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDecisionReplay } from '../src/lib/decision/replay';

const tenant = 'tenant-a';
const at = (minute: number) => new Date(`2026-09-29T12:${String(minute).padStart(2, '0')}:00.000Z`);
function fixture() {
  const reads: string[] = [], writes: string[] = [], outcomes: any[] = [];
  let missing = false, ambiguousOutbound = false;
  const decision: any = { id: 'decision-a', userId: tenant, prospectId: 'prospect-a',
    conversationId: 'conversation-a', inputMessageId: 'message-a', decisionType: 'INBOUND_TRIAGE',
    status: 'READY', source: 'GEMINI', createdAt: at(2), contextFingerprint: 'fingerprint-a',
    primaryIntent: 'PRICING_INQUIRY', secondaryIntents: ['MEETING_REQUEST'], confidenceScore: 88,
    intentSignals: [{ intent: 'PRICING_INQUIRY', confidence: 88, evidence: 'pricing' }],
    interpretation: 'The prospect asked about pricing.', recommendedNextAction: 'ASK_CLARIFYING_QUESTION',
    suggestedReply: 'Which plan?', requiresReview: false, reviewReasons: [], explanation: 'Pricing was mentioned.',
    provider: 'GEMINI', model: 'gemini-2.5-flash',
    prospect: { id: 'prospect-a', firstName: 'Alex', lastName: 'Lee', companyName: 'Acme' },
    conversation: { id: 'conversation-a' },
    inputMessage: { id: 'message-a', sourceType: 'INBOUND_SIGNAL', sourceId: 'signal-a',
      direction: 'INBOUND', body: 'Please share pricing.', occurredAt: at(0), providerId: null },
    trace: { id: 'trace-a', userId: tenant, decisionId: 'decision-a', createdAt: at(3),
      contextFingerprint: 'fingerprint-a', engineVersion: 'reply-decision-v1',
      icpState: { qualification: 'QUALIFIED', fitScore: 84, valueBand: 'HIGH' },
      memoryState: { eventCount: 2, eventIds: ['memory-a'] },
      brainRevision: 4, brainEntryIds: ['brain-entry-a'], playbookRevision: 3,
      playbookRuleIds: ['playbook-rule-a'], constitutionRevision: 2,
      contextReferences: { constitutionRuleIds: ['constitution-rule-a'] },
      policyResult: [{ action: 'OUTREACH', decision: 'ALLOWED', effectiveEffect: 'ALLOW',
        matchedRuleIds: ['constitution-rule-a'], unresolvedRuleIds: [],
        ruleTrace: [{ ruleId: 'constitution-rule-a', finalEffectiveResult: 'ALLOW' }] }] } };
  const resolutions: any[] = [{ id: 'resolution-a', userId: tenant, decisionId: decision.id,
    requestedMode: 'HUMAN_APPROVAL', resolvedMode: 'HUMAN_APPROVAL', state: 'PENDING_APPROVAL',
    reasons: [], policyRevision: 2, decisionConstitutionRevision: 2, currentConstitutionRevision: 2,
    constitutionRuleIds: ['constitution-rule-a'], prospectHoldId: null, campaignOverrideId: null, createdAt: at(4) }];
  const actions: any[] = [{ id: 'action-a', userId: tenant, decisionId: decision.id, action: 'APPROVE',
    actorUserId: tenant, reason: null, resultingState: 'EXECUTED', executionAttemptId: 'attempt-a',
    editedDraft: null, createdAt: at(7) }];
  const assignment: any = { id: 'assignment-a', status: 'RESOLVED', queue: 'HUMAN_REVIEW',
    reason: 'Human approval', assignedAt: at(5), resolvedAt: at(9) };
  const execution: any = { id: 'attempt-a', status: 'SENT', mode: 'HUMAN_APPROVAL',
    startedAt: at(8), completedAt: at(9), provider: 'IMAP_NATIVE',
    providerMessageId: 'provider-a', failureClass: null,
    decisionConstitutionRevision: 2, executionConstitutionRevision: 3 };
  const risk: any = { id: 'risk-a', status: 'APPLICABLE', score: 78, band: 'HIGH', confidence: 'MEDIUM',
    reasons: ['Commercial intent recorded.'], components: [{ signal: 'intent', value: 85 }],
    scoringVersion: 'revenue-risk-v1', evaluatedAt: at(6) };
  const sla: any = { id: 'sla-a', status: 'RESOLVED', startedAt: at(5), dueAt: at(45),
    breachedAt: null, resolvedAt: at(9), cancelledAt: null, escalationLevel: 0,
    escalationReason: null, resolutionReason: 'GOVERNED_SEND_COMPLETED', riskBandAtStart: 'HIGH',
    riskScoreAtStart: 78, policyRevision: 1 };
  function model(name: string, methods: Record<string, (...args: any[]) => any>) {
    return new Proxy(methods, { get(target, key) {
      if (typeof key === 'string' && /^(create|update|upsert|delete|createMany|updateMany|deleteMany)$/.test(key))
        return () => { writes.push(`${name}.${key}`); throw new Error(`Forbidden write ${name}.${key}`); };
      return target[key as keyof typeof target];
    } });
  }
  function own(name: string, where: any) {
    reads.push(name);
    assert.equal(where.userId ?? where.userId_decisionId?.userId, tenant);
    return where.decisionId ?? where.userId_decisionId?.decisionId;
  }
  const db: any = {
    decision: model('decision', { findFirst: async ({ where }: any) => {
      reads.push('decision'); return where.userId === tenant && where.id === decision.id ? decision : null; } }),
    decisionAutomationResolution: model('resolution', { findMany: async ({ where }: any) => {
      own('resolution', where); return resolutions; } }),
    decisionActionEvent: model('action', { findMany: async ({ where }: any) => {
      own('action', where); return actions; } }),
    decisionAssignment: model('assignment', { findUnique: async ({ where }: any) => {
      own('assignment', where); return assignment; } }),
    decisionExecutionAttempt: model('execution', { findUnique: async ({ where }: any) => {
      own('execution', where); return execution; } }),
    decisionRevenueRisk: model('risk', { findUnique: async ({ where }: any) => {
      own('risk', where); return missing ? null : risk; } }),
    responseSLAInstance: model('sla', { findUnique: async ({ where }: any) => {
      own('sla', where); return missing ? null : sla; } }),
    decisionOutcome: model('outcome', { findMany: async ({ where }: any) => {
      own('outcome', where); return outcomes; } }),
    conversationMessage: model('message', { findMany: async ({ where }: any) => {
      own('message', where); assert.equal(where.conversationId, decision.conversationId);
      const row = { id: 'outbound-message-a', sourceId: 'outbound-a', occurredAt: at(9), providerId: 'provider-a' };
      return ambiguousOutbound ? [row, { ...row, id: 'outbound-message-b', sourceId: 'outbound-b' }] : [row]; } }),
    outboundLog: model('outbound', { findFirst: async ({ where }: any) => {
      reads.push('outbound'); assert.equal(where.lead.userId, tenant);
      return { id: 'outbound-a', status: 'sent', channel: 'email', sentAt: at(9) }; } }),
    prospectMemoryEvent: model('memory', {}), frameLeadsBrain: model('brain', {}),
    revenuePlaybook: model('playbook', {}), salesConstitution: model('constitution', {}),
    aIUsageEvent: model('usage', {}),
  };
  return { db, decision, resolutions, actions, execution, reads, writes,
    setMissing: () => { missing = true; decision.trace = null; execution.providerMessageId = null; },
    setAmbiguousOutbound: () => { ambiguousOutbound = true; },
    addOutcome: () => outcomes.push({ id: 'outcome-a', revision: 1, outcomeType: 'MEETING_BOOKED',
      source: 'HUMAN_RECORDED', note: 'Confirmed by prospect.', occurredAt: at(10), createdAt: at(11) }) };
}

test('tenant-owned Replay reconstructs trigger, trace, governance, automation, risk, SLA and execution', async () => {
  const f = fixture();
  const replay = await getDecisionReplay({ userId: tenant, decisionId: 'decision-a' }, f.db);
  assert.equal(replay.trigger.message.body, 'Please share pricing.');
  assert.equal(replay.knownAtDecision.brainRevision, 4);
  assert.equal(replay.knownAtDecision.playbookRevision, 3);
  assert.equal(replay.knownAtDecision.constitutionRevision, 2);
  assert.equal(replay.interpretation.primaryIntent, 'PRICING_INQUIRY');
  assert.equal(replay.interpretation.confidenceScore, 88);
  assert.deepEqual(replay.governance.decisionTime?.policy[0].matchedRuleIds, ['constitution-rule-a']);
  assert.equal(replay.governance.executionTime?.executionConstitutionRevision, 3);
  assert.equal(replay.automation.history[0].state, 'PENDING_APPROVAL');
  assert.equal(replay.risk?.score, 78); assert.equal(replay.risk?.provenance, 'LATEST_PERSISTED_ASSESSMENT');
  assert.equal(replay.sla?.initialRiskBand, 'HIGH');
  assert.equal(replay.human.actions[0].action, 'APPROVE');
  assert.equal(replay.execution?.outbound?.id, 'outbound-a');
  assert.equal(replay.finalState.state, 'SENT');
  assert.ok(replay.timeline.some(row => row.type === 'MESSAGE_SENT'));
  assert.deepEqual([...replay.timeline].sort((a, b) => a.at.localeCompare(b.at) || a.type.localeCompare(b.type) || a.sourceId.localeCompare(b.sourceId)), replay.timeline);
  assert.deepEqual(f.writes, []);
});

test('cross-tenant replay is rejected before related records are read', async () => {
  const f = fixture();
  await assert.rejects(() => getDecisionReplay({ userId: 'tenant-b', decisionId: 'decision-a' }, f.db), /not found for tenant/);
  assert.deepEqual(f.reads, ['decision']); assert.deepEqual(f.writes, []);
});

test('missing trace and replaceable assessments remain explicitly unavailable', async () => {
  const f = fixture(); f.setMissing();
  const replay = await getDecisionReplay({ userId: tenant, decisionId: 'decision-a' }, f.db);
  assert.equal(replay.knownAtDecision.brainRevision, null);
  assert.equal(replay.knownAtDecision.playbookRevision, null);
  assert.equal(replay.governance.decisionTime, null);
  assert.equal(replay.risk, null); assert.equal(replay.sla, null);
  assert.equal(replay.execution?.outbound, null);
  assert.ok(!f.reads.includes('brain') && !f.reads.includes('playbook') && !f.reads.includes('constitution'));
  assert.deepEqual(f.writes, []);
});

test('ambiguous provider correlation does not attribute an unrelated OutboundLog', async () => {
  const f = fixture(); f.setAmbiguousOutbound();
  const replay = await getDecisionReplay({ userId: tenant, decisionId: 'decision-a' }, f.db);
  assert.equal(replay.execution?.outbound, null);
  assert.ok(!replay.timeline.some(row => row.type === 'MESSAGE_SENT'));
  assert.ok(!f.reads.includes('outbound'));
});

test('human business outcome is shown after immutable Decision evidence', async () => {
  const f = fixture(); f.addOutcome();
  const replay = await getDecisionReplay({ userId: tenant, decisionId: 'decision-a' }, f.db);
  assert.equal(replay.outcomes.current?.outcomeType, 'MEETING_BOOKED');
  assert.equal(replay.finalState.state, 'SENT');
  assert.ok(replay.timeline.some(row => row.type === 'BUSINESS_OUTCOME_RECORDED' && row.at === at(11).toISOString()));
  assert.deepEqual(f.writes, []);
});

test('repeated Replay reads make no writes, provider calls, sends, or AI usage rows', async () => {
  const f = fixture();
  const first = await getDecisionReplay({ userId: tenant, decisionId: 'decision-a' }, f.db);
  const second = await getDecisionReplay({ userId: tenant, decisionId: 'decision-a' }, f.db);
  assert.deepEqual(first, second); assert.deepEqual(f.writes, []);
  const source = readFileSync(require.resolve('../src/lib/decision/replay.ts'), 'utf8');
  assert.doesNotMatch(source, /gemini|anthropic|recordAIUsage|runAutopilot|assessRevenueAtRisk|syncResponseSLA|sendNativeEmail/i);
});
