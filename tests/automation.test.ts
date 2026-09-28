import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutomationMode, AutomationExecutionState, CampaignAutomationMode, ConstitutionEffect } from '@prisma/client';
import { DEFAULT_AUTOMATION_POLICY, automaticExecutionRolloutEnabled, getAutomationPolicy,
  setLeadListAutomationOverride, setProspectHold, validateAutomationPolicy } from '../src/lib/automation/policy';
import { evaluateAutomationMode } from '../src/lib/automation/resolve';
import { actOnDecision, runAutopilot } from '../src/lib/automation/actions';

const tenant = 'tenant-a';
function fixture() {
  let policy: any = null, hold: any = null, override: any = null, suppression = false;
  let constitutionRevision = 1, rules: any[] = [], sends = 0, aiCalls = 0;
  let confidence = 96, status = 'READY', review = false, leadEmail = 'lead@example.com';
  let priorAutoSends = 0;
  const attempts: any[] = [], actions: any[] = [], resolutions: any[] = [], assignments: any[] = [], memories: any[] = [];
  const decision: any = { id: 'decision-a', userId: tenant, prospectId: 'prospect-a', status,
    primaryIntent: 'OTHER', suggestedReply: 'Thank you for your reply.', confidenceScore: confidence,
    requiresReview: review, reviewReasons: [], trace: { constitutionRevision: 1, brainRevision: 1, playbookRevision: 1 },
    inputMessage: { sourceId: 'signal-a', sourceType: 'INBOUND_SIGNAL' } };
  const db: any = {
    $transaction: async (fn: any) => fn(db),
    user: { findUnique: async ({ where }: any) => where.id === tenant ? { id: tenant,
      imapEmail: 'owner@example.com', imapPassword: 'encrypted', imapHost: 'imap.gmail.com' } : null,
      findUniqueOrThrow: async () => ({ imapEmail: 'owner@example.com' }) },
    automationPolicy: { findUnique: async ({ where }: any) => where.userId === tenant ? policy : null },
    decision: { findFirst: async ({ where }: any) => where.userId === tenant && where.id === decision.id ? decision : null },
    inboundSignal: { findFirst: async ({ where }: any) => where.userId !== tenant ? null : where.signalType === 'UNSUBSCRIBE_CONFIRMED' ?
      (suppression ? { id: 'unsubscribe' } : null) : { id: 'signal-a', generatedLeadId: 'lead-a', prospectContext: null,
        generatedLead: { id: 'lead-a', listId: 'list-a', email: leadEmail } } },
    prospectHold: { findUnique: async () => hold, upsert: async ({ create, update }: any) => {
      hold = { id: 'hold-a', ...(hold ?? create), ...update }; return hold; } },
    prospect: { findUnique: async ({ where }: any) => where.userId_id.userId === tenant ? { id: 'prospect-a' } : null },
    leadList: { findFirst: async ({ where }: any) => where.userId === tenant ? { id: 'list-a' } : null },
    automationCampaignOverride: { findUnique: async () => override, upsert: async ({ create, update }: any) => {
      override = { id: 'override-a', ...(override ?? create), ...update }; return override; } },
    decisionExecutionAttempt: { findUnique: async () => attempts[0] ?? null, count: async () => priorAutoSends + attempts.filter(x => x.status === 'SENT' && x.mode === 'AUTOPILOT').length,
      create: async ({ data }: any) => { const row = { id: 'attempt-a', status: 'CLAIMED', ...data }; attempts.push(row); return row; },
      update: async ({ data }: any) => Object.assign(attempts[0], data),
      updateMany: async ({ data }: any) => { if (attempts[0]?.status === 'CLAIMED') Object.assign(attempts[0], data); } },
    decisionActionEvent: { findFirst: async ({ where }: any) => where.executionAttemptId ? actions.find(x => x.executionAttemptId === where.executionAttemptId) ?? null : actions.at(-1) ?? null,
      findUnique: async ({ where }: any) => actions.find(x => x.idempotencyKey === where.idempotencyKey) ?? null,
      create: async ({ data }: any) => { const row = { id: `action-${actions.length + 1}`, createdAt: new Date(), ...data }; actions.push(row); return row; } },
    decisionAutomationResolution: { findFirst: async () => resolutions.at(-1) ?? null,
      create: async ({ data }: any) => { const row = { id: `resolution-${resolutions.length + 1}`, ...data }; resolutions.push(row); return row; } },
    decisionAssignment: { upsert: async ({ create, update }: any) => { const row = assignments[0] ?? { id: 'assignment-a', ...create };
      Object.assign(row, update); if (!assignments.length) assignments.push(row); return row; } },
    frameLeadsBrain: { findUnique: async () => ({ revision: 1 }) },
    revenuePlaybook: { findUnique: async () => ({ revision: 1 }) },
    salesConstitution: { findUnique: async () => ({ id: 'constitution-a', revision: constitutionRevision }) },
    salesConstitutionRule: { findMany: async ({ where }: any) => rules.filter(r => r.actionTypes.includes(where.actionTypes.has)) },
    prospectMemoryState: { upsert: async () => ({}), update: async () => ({}) },
    prospectMemoryEvent: { createMany: async ({ data }: any) => { if (memories.some(x => x.sourceId === data[0].sourceId)) return { count: 0 };
      memories.push(data[0]); return { count: 1 }; }, findMany: async () => memories,
      findFirst: async () => memories.length ? { occurredAt: new Date() } : null },
    sendingInbox: { findFirst: async () => ({ id: 'inbox-a' }) },
    outboundLog: { create: async () => ({ id: 'log-a', sentAt: new Date() }) },
    conversation: { upsert: async () => ({ id: 'conversation-a' }), update: async () => ({ id: 'conversation-a' }) },
    conversationMessage: { createMany: async () => ({ count: 1 }), findUniqueOrThrow: async () => ({ id: 'message-a' }) },
  };
  const sender: any = async () => { sends++; return { providerMessageId: 'provider-a' }; };
  return { db, sender, attempts, actions, resolutions, assignments, memories,
    setPolicy: (value: any) => { policy = { id: 'policy-a', userId: tenant, ...DEFAULT_AUTOMATION_POLICY, revision: 2, ...value }; },
    setHold: (active: boolean) => { hold = { id: 'hold-a', active, reason: 'Review required' }; },
    setSuppression: (value: boolean) => { suppression = value; },
    setDecision: (value: any) => { Object.assign(decision, value); },
    setRules: (value: any[]) => { rules = value; constitutionRevision++; },
    sends: () => sends, aiCalls: () => aiCalls,
    setLeadEmail: (value: string) => { leadEmail = value; },
    setPriorAutoSends: (value: number) => { priorAutoSends = value; },
  };
}
const rule = (effect: ConstitutionEffect, kind: 'PROHIBITED_CLAIM' | 'CUSTOM_MANUAL' = 'PROHIBITED_CLAIM') => ({
  id: `rule-${effect}`, name: effect, category: 'CLAIM', scope: 'GLOBAL', severity: 'HIGH', priority: 1, effect,
  actionTypes: ['CLAIM'], constraint: kind === 'CUSTOM_MANUAL' ? { kind } : { kind, terms: ['Thank you'] } });

test('safe tenant defaults and separate execution rollout', async () => {
  const f = fixture();
  assert.equal((await getAutomationPolicy(tenant, f.db)).defaultMode, AutomationMode.HUMAN_APPROVAL);
  assert.equal((await getAutomationPolicy(tenant, f.db)).autopilotEnabled, false);
  assert.equal(automaticExecutionRolloutEnabled(undefined), false);
  assert.equal(automaticExecutionRolloutEnabled('true'), true);
  await assert.rejects(() => getAutomationPolicy('tenant-b', f.db), /Tenant not found/);
  assert.throws(() => validateAutomationPolicy({ ...DEFAULT_AUTOMATION_POLICY, fallbackMode: 'AUTOPILOT' }), /Unknown policy field|Fallback/);
});

test('default approval, owned list overrides, hold and tenant boundaries', async () => {
  const f = fixture();
  assert.equal((await evaluateAutomationMode({ userId: tenant, decisionId: 'decision-a' }, f.db)).state, AutomationExecutionState.PENDING_APPROVAL);
  await assert.rejects(() => evaluateAutomationMode({ userId: 'tenant-b', decisionId: 'decision-a' }, f.db), /not found for tenant/);
  await assert.rejects(() => setLeadListAutomationOverride({ userId: 'tenant-b', leadListId: 'list-a', mode: CampaignAutomationMode.AUTOPILOT }, f.db), /not found/);
  await setLeadListAutomationOverride({ userId: tenant, leadListId: 'list-a', mode: CampaignAutomationMode.MANDATORY_ESCALATION }, f.db);
  assert.equal((await evaluateAutomationMode({ userId: tenant, decisionId: 'decision-a' }, f.db)).state, AutomationExecutionState.ESCALATED);
  await assert.rejects(() => setProspectHold({ userId: 'tenant-b', prospectId: 'prospect-a', active: true, reason: 'x' }, f.db), /not found/);
  await setProspectHold({ userId: tenant, prospectId: 'prospect-a', active: true, reason: 'Review required' }, f.db);
  assert.equal((await evaluateAutomationMode({ userId: tenant, decisionId: 'decision-a' }, f.db)).state, AutomationExecutionState.HELD);
  await setProspectHold({ userId: tenant, prospectId: 'prospect-a', active: false }, f.db);
});

test('Constitution block, human, approval and unresolved rules constrain autonomy', async () => {
  const f = fixture(); f.setPolicy({ defaultMode: 'AUTOPILOT', autopilotEnabled: true, autoExecutionDisabled: false });
  for (const [effect, state] of [['BLOCK', 'BLOCKED'], ['REQUIRE_HUMAN', 'ESCALATED'],
    ['REQUIRE_APPROVAL', 'PENDING_APPROVAL'], ['REQUIRE_SAFE_RESPONSE', 'ESCALATED']] as const) {
    f.setRules([rule(effect)]);
    assert.equal((await evaluateAutomationMode({ userId: tenant, decisionId: 'decision-a' }, f.db)).state, state);
  }
  f.setRules([rule(ConstitutionEffect.REQUIRE_APPROVAL, 'CUSTOM_MANUAL')]);
  assert.equal((await evaluateAutomationMode({ userId: tenant, decisionId: 'decision-a' }, f.db)).state, 'ESCALATED');
  assert.equal(f.aiCalls(), 0);
});

test('review, confidence, kill switch, suppression and cap fail closed', async () => {
  const f = fixture(); f.setPolicy({ defaultMode: 'AUTOPILOT', autopilotEnabled: true, autoExecutionDisabled: false });
  f.setDecision({ confidenceScore: 60 });
  assert.ok((await evaluateAutomationMode({ userId: tenant, decisionId: 'decision-a' }, f.db)).reasons.includes('CONFIDENCE_BELOW_AUTOPILOT_THRESHOLD'));
  f.setDecision({ confidenceScore: 96, requiresReview: true });
  assert.ok((await evaluateAutomationMode({ userId: tenant, decisionId: 'decision-a' }, f.db)).reasons.includes('DECISION_REQUIRES_REVIEW'));
  f.setDecision({ requiresReview: false }); f.setPolicy({ defaultMode: 'AUTOPILOT', autopilotEnabled: true, autoExecutionDisabled: true });
  assert.ok((await evaluateAutomationMode({ userId: tenant, decisionId: 'decision-a' }, f.db)).reasons.includes('AUTOMATIC_EXECUTION_DISABLED'));
  f.setSuppression(true);
  assert.equal((await evaluateAutomationMode({ userId: tenant, decisionId: 'decision-a' }, f.db)).state, 'BLOCKED');
  const action = await runAutopilot({ userId: tenant, decisionId: 'decision-a' }, { db: f.db, sender: f.sender });
  assert.equal(action.state, 'BLOCKED'); assert.equal(f.sends(), 0);
});

test('reject and escalate audit without sending; cross-tenant action rejected', async () => {
  const f = fixture();
  await assert.rejects(() => actOnDecision({ userId: 'tenant-b', decisionId: 'decision-a', action: 'APPROVE', requestKey: 'request-abc' }, { db: f.db, sender: f.sender }), /not found for tenant/);
  const escalated = await actOnDecision({ userId: tenant, decisionId: 'decision-a', action: 'ESCALATE', requestKey: 'request-escalate', reason: 'Needs owner' }, { db: f.db, sender: f.sender });
  assert.equal(escalated.state, 'ESCALATED'); assert.equal(f.assignments.length, 1);
  assert.equal(f.sends(), 0);
  const repeat = await actOnDecision({ userId: tenant, decisionId: 'decision-a', action: 'ESCALATE', requestKey: 'request-escalate' }, { db: f.db, sender: f.sender });
  assert.equal(repeat.reused, true);
  assert.equal(f.actions.length, 1);
});

test('Approve claims once, records execution, and duplicate request does not send twice', async () => {
  const f = fixture();
  const input = { userId: tenant, decisionId: 'decision-a', action: 'APPROVE' as const, requestKey: 'approve-once' };
  const first = await actOnDecision(input, { db: f.db, sender: f.sender });
  assert.equal(first.state, 'EXECUTED'); assert.equal(f.sends(), 1);
  assert.equal(f.attempts[0].status, 'SENT'); assert.equal(f.actions[0].originalDraft, 'Thank you for your reply.');
  await actOnDecision(input, { db: f.db, sender: f.sender });
  await actOnDecision({ ...input, requestKey: 'approve-again' }, { db: f.db, sender: f.sender });
  assert.equal(f.sends(), 1); assert.equal(f.attempts.length, 1);
  assert.equal(f.memories.filter(x => x.eventType === 'HUMAN_APPROVED').length, 1);
});

test('Edit & Send preserves both drafts and checks edited claim against current Constitution', async () => {
  const f = fixture();
  f.setRules([{ ...rule(ConstitutionEffect.BLOCK), constraint: { kind: 'PROHIBITED_CLAIM', terms: ['guaranteed'] } }]);
  const blocked = await actOnDecision({ userId: tenant, decisionId: 'decision-a', action: 'EDIT_AND_SEND',
    requestKey: 'edit-blocked', editedReply: 'Guaranteed results.' }, { db: f.db, sender: f.sender });
  assert.equal(blocked.state, 'BLOCKED'); assert.equal(f.sends(), 0);
  const safe = await actOnDecision({ userId: tenant, decisionId: 'decision-a', action: 'EDIT_AND_SEND',
    requestKey: 'edit-safe', editedReply: 'I can share details.' }, { db: f.db, sender: f.sender });
  assert.equal(safe.state, 'EXECUTED'); assert.equal(f.sends(), 1);
  assert.equal(f.actions[0].originalDraft, 'Thank you for your reply.');
  assert.equal(f.actions[0].editedDraft, 'I can share details.');
  assert.equal(f.attempts[0].sentContent, 'I can share details.');
});

test('Provider uncertainty is terminal and never automatically retried', async () => {
  const f = fixture(); let calls = 0;
  const sender: any = async () => { calls++; throw new Error('timeout after possible send'); };
  const input = { userId: tenant, decisionId: 'decision-a', action: 'APPROVE' as const, requestKey: 'uncertain-send' };
  const result = await actOnDecision(input, { db: f.db, sender });
  assert.equal(result.state, 'FAILED_UNCERTAIN'); assert.equal(f.attempts[0].status, 'FAILED_UNCERTAIN');
  await actOnDecision({ ...input, requestKey: 'uncertain-retry' }, { db: f.db, sender });
  assert.equal(calls, 1);
});

test('Autopilot needs explicit rollout, eligibility, cap and remains retry-safe', async () => {
  const prior = process.env.AUTOMATION_EXECUTION_ENABLED;
  process.env.AUTOMATION_EXECUTION_ENABLED = 'true';
  try {
    const f = fixture(); f.setPolicy({ defaultMode: 'AUTOPILOT', autopilotEnabled: true,
      autoExecutionDisabled: false, maxAutoSendsPerDay: 1 });
    assert.equal((await evaluateAutomationMode({ userId: tenant, decisionId: 'decision-a' }, f.db)).state, 'READY');
    const result = await runAutopilot({ userId: tenant, decisionId: 'decision-a' }, { db: f.db, sender: f.sender });
    assert.equal(result.state, 'EXECUTED');
    await runAutopilot({ userId: tenant, decisionId: 'decision-a' }, { db: f.db, sender: f.sender });
    assert.equal(f.sends(), 1);
    const capped = fixture(); capped.setPolicy({ defaultMode: 'AUTOPILOT', autopilotEnabled: true,
      autoExecutionDisabled: false, maxAutoSendsPerDay: 1 });
    capped.setPriorAutoSends(1);
    const state = await evaluateAutomationMode({ userId: tenant, decisionId: 'decision-a' }, capped.db);
    assert.notEqual(state.resolvedMode, 'AUTOPILOT');
    assert.equal((await runAutopilot({ userId: tenant, decisionId: 'decision-a' }, { db: capped.db, sender: capped.sender })).state, 'PENDING_APPROVAL');
    assert.equal(capped.sends(), 0);
  } finally {
    if (prior === undefined) delete process.env.AUTOMATION_EXECUTION_ENABLED;
    else process.env.AUTOMATION_EXECUTION_ENABLED = prior;
  }
});

test('Reject records a bounded reason without any outbound attempt or AI usage', async () => {
  const f = fixture();
  const result = await actOnDecision({ userId: tenant, decisionId: 'decision-a', action: 'REJECT',
    requestKey: 'reject-abc', reason: '  Poor timing  ' }, { db: f.db, sender: f.sender });
  assert.equal(result.state, 'REJECTED');
  assert.equal(f.actions[0].reason, 'Poor timing');
  assert.equal(f.attempts.length, 0); assert.equal(f.sends(), 0); assert.equal(f.aiCalls(), 0);
  assert.equal(f.memories.filter(x => x.eventType === 'HUMAN_REJECTED').length, 1);
});
