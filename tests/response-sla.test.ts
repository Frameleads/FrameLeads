import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateResponseDeadline, displayResponseSLA, responseSLAApplicability,
  sortInboxByResponseSLA } from '../src/lib/response-sla/deadline';
import { DEFAULT_RESPONSE_SLA_POLICY, getResponseSLAPolicy, saveResponseSLAPolicy,
  validateResponseSLAPolicy } from '../src/lib/response-sla/policy';
import { evaluateResponseSLA, syncResponseSLAForDecision } from '../src/lib/response-sla/service';

const startedAt = new Date('2026-09-28T12:00:00.000Z');
const later = (minutes: number) => new Date(startedAt.getTime() + minutes * 60_000);

test('configured band and unknown durations calculate exact UTC deadlines', () => {
  const policy = DEFAULT_RESPONSE_SLA_POLICY;
  for (const [band, minutes] of [['CRITICAL', 15], ['HIGH', 60], ['MEDIUM', 240],
    ['LOW', 1440], [null, 240]] as const) {
    assert.equal(calculateResponseDeadline({ startedAt, riskBand: band, policy }).toISOString(), later(minutes).toISOString());
  }
  assert.equal(policy.dueSoonPercent, 75);
  assert.throws(() => validateResponseSLAPolicy({ ...policy, unknownMinutes: 0, revision: undefined }), /Unknown|minutes/);
});

test('applicability separates human responsibility from non-revenue and blocked actions', () => {
  const base = { decisionStatus: 'READY', primaryIntent: 'PRICING_INQUIRY', riskStatus: 'APPLICABLE',
    automationState: 'PENDING_APPROVAL', automationMode: 'HUMAN_APPROVAL', executionStatus: null,
    confirmedSuppression: false };
  assert.equal(responseSLAApplicability(base).applies, true);
  assert.equal(responseSLAApplicability({ ...base, decisionStatus: 'PENDING' }).applies, false);
  assert.equal(responseSLAApplicability({ ...base, automationState: 'ESCALATED', automationMode: 'MANDATORY_ESCALATION' }).applies, true);
  assert.equal(responseSLAApplicability({ ...base, decisionStatus: 'NEEDS_REVIEW', automationState: null, automationMode: null }).applies, true);
  assert.equal(responseSLAApplicability({ ...base, automationState: 'FAILED_UNCERTAIN' }).applies, true);
  for (const primaryIntent of ['SPAM', 'OUT_OF_OFFICE', 'UNSUBSCRIBE'])
    assert.equal(responseSLAApplicability({ ...base, primaryIntent }).applies, false);
  assert.equal(responseSLAApplicability({ ...base, confirmedSuppression: true }).applies, false);
  assert.equal(responseSLAApplicability({ ...base, automationState: 'BLOCKED' }).applies, false);
  assert.equal(responseSLAApplicability({ ...base, automationState: 'EXECUTED', executionStatus: 'SENT' }).applies, false);
});

test('due soon is derived without mutation and breach ordering is stable', () => {
  const sla: any = { status: 'ACTIVE', startedAt, dueAt: later(60), dueSoonPercent: 75 };
  assert.equal(displayResponseSLA(sla, later(44)).state, 'ACTIVE');
  assert.equal(displayResponseSLA(sla, later(45)).state, 'DUE_SOON');
  assert.equal(displayResponseSLA(sla, later(60)).state, 'OVERDUE');
  const rows = [{ id: 'later', responseSLA: { status: 'ACTIVE', startedAt, dueAt: later(60) } },
    { id: 'none', responseSLA: null },
    { id: 'breached', responseSLA: { status: 'BREACHED', startedAt, dueAt: later(10) } },
    { id: 'soon', responseSLA: { status: 'ACTIVE', startedAt, dueAt: later(50) } }];
  assert.deepEqual(sortInboxByResponseSLA(rows, later(40), 75).map(row => row.id),
    ['breached', 'soon', 'later', 'none']);
});

function fixture() {
  let policy: any = null, risk: any = { decisionId: 'd1', status: 'APPLICABLE', score: 75, band: 'HIGH', confidence: 'MEDIUM' };
  let mode = 'HUMAN_APPROVAL', state = 'PENDING_APPROVAL', decisionStatus = 'READY', primaryIntent = 'PRICING_INQUIRY';
  let attempt: any = null, rejectedAt: Date | null = null, suppression = false, sla: any = null, assignment: any = null;
  let createCount = 0, assignmentCreates = 0, aiCalls = 0, sends = 0;
  const db: any = {
    $transaction: async (fn: any) => fn(db),
    user: { findUnique: async ({ where }: any) => where.id === 'tenant-a' ? { id: 'tenant-a' } : null },
    responseSLAPolicy: { findUnique: async () => policy,
      upsert: async ({ create, update }: any) => { policy = policy ? { ...policy, ...update,
        revision: policy.revision + 1 } : { ...create, revision: 1 }; return policy; } },
    decision: { findMany: async ({ where }: any) => where.userId === 'tenant-a' && where.id.in.includes('d1') ?
      [{ id: 'd1', prospectId: 'p1', primaryIntent, status: decisionStatus, updatedAt: startedAt }] : [] },
    responseSLAInstance: {
      findMany: async ({ where }: any) => sla && where.userId === 'tenant-a' ? [sla] : [],
      findFirst: async ({ where }: any) => sla && where.userId === 'tenant-a' && where.id === sla.id ? sla : null,
      findUniqueOrThrow: async () => sla,
      upsert: async ({ create }: any) => { if (!sla) { createCount++; sla = { id: 'sla-1',
        breachedAt: null, resolvedAt: null, cancelledAt: null, escalationLevel: 0, escalationReason: null,
        ...create }; } return sla; },
      update: async ({ data }: any) => { Object.assign(sla, data); return sla; },
      updateMany: async ({ where, data }: any) => { if (!sla || sla.status !== where.status || sla.dueAt > where.dueAt.lte)
        return { count: 0 }; Object.assign(sla, data); return { count: 1 }; },
    },
    decisionRevenueRisk: { findMany: async () => risk ? [risk] : [] },
    decisionAutomationResolution: {
      findMany: async () => [{ decisionId: 'd1', state, resolvedMode: mode, createdAt: startedAt }],
      groupBy: async ({ where }: any) => where.state ?
        (['HUMAN_APPROVAL', 'MANDATORY_ESCALATION'].includes(mode) && ['PENDING_APPROVAL', 'ESCALATED'].includes(state) ?
          [{ decisionId: 'd1', _min: { createdAt: startedAt } }] : []) : [],
    },
    decisionExecutionAttempt: { findMany: async () => attempt ? [attempt] : [] },
    decisionActionEvent: { groupBy: async () => rejectedAt ? [{ decisionId: 'd1', _min: { createdAt: rejectedAt } }] : [] },
    inboundSignal: { findMany: async () => suppression ? [{ prospectId: 'p1' }] : [] },
    decisionAssignment: { findMany: async () => assignment ? [assignment] : [],
      upsert: async ({ create, update }: any) => { if (!assignment) { assignmentCreates++;
        assignment = { id: 'assignment-1', ...create }; } else Object.assign(assignment, update); return assignment; } },
  };
  return { db, get: () => ({ sla, assignment, createCount, assignmentCreates, aiCalls, sends }),
    setRisk: (value: any) => { risk = value; }, setMode: (value: string, nextState: string) => { mode = value; state = nextState; },
    setDecision: (status: string, intent = 'PRICING_INQUIRY') => { decisionStatus = status; primaryIntent = intent; },
    setAttempt: (status: string, completedAt = later(20)) => { attempt = { decisionId: 'd1', status, completedAt }; },
    setRejection: (at = later(20)) => { rejectedAt = at; }, setSuppression: () => { suppression = true; },
    setAssignment: (queue: string) => { assignment = { id: 'assignment-1', decisionId: 'd1', queue,
      reason: 'Specialized review', status: 'OPEN' }; },
    setPolicy: (value: any) => { policy = { ...DEFAULT_RESPONSE_SLA_POLICY, revision: 2, ...value }; },
  };
}

test('safe tenant defaults, isolation, lazy creation and stable risk snapshot', async () => {
  const f = fixture();
  assert.equal((await getResponseSLAPolicy('tenant-a', f.db)).enabled, true);
  await assert.rejects(() => getResponseSLAPolicy('tenant-b', f.db), /Tenant not found/);
  await assert.rejects(() => syncResponseSLAForDecision({ userId: 'tenant-b', decisionId: 'd1', now: startedAt }, f.db), /Tenant not found|not found for tenant/);
  const first = await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: startedAt }, f.db);
  assert.equal(first!.startedAt.toISOString(), startedAt.toISOString());
  assert.equal(first!.dueAt.toISOString(), later(60).toISOString());
  f.setRisk({ decisionId: 'd1', status: 'APPLICABLE', score: 99, band: 'CRITICAL', confidence: 'HIGH' });
  const second = await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: later(20) }, f.db);
  assert.equal(second!.dueAt.toISOString(), later(60).toISOString());
  assert.equal(second!.riskBandAtStart, 'HIGH'); assert.equal(f.get().createCount, 1);
});

test('policy writes validate bounded durations and reject another tenant', async () => {
  const f = fixture();
  await assert.rejects(() => saveResponseSLAPolicy('tenant-b', { ...DEFAULT_RESPONSE_SLA_POLICY }, f.db), /Unknown|Tenant/);
  const values = { enabled: true, criticalMinutes: 20, highMinutes: 70, mediumMinutes: 250,
    lowMinutes: 1500, unknownMinutes: 300, dueSoonPercent: 80, breachEscalationEnabled: false };
  const saved = await saveResponseSLAPolicy('tenant-a', values, f.db);
  assert.equal(saved.criticalMinutes, 20); assert.equal(saved.revision, 1);
  assert.throws(() => validateResponseSLAPolicy({ ...values, lowMinutes: 10081 }), /lowMinutes/);
});

test('first breach is durable, idempotent, and preserves a specialized assignment', async () => {
  const f = fixture(); f.setAssignment('LEGAL');
  await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: startedAt }, f.db);
  const first = await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: later(60) }, f.db);
  assert.equal(first!.status, 'BREACHED'); assert.equal(first!.breachedAt!.toISOString(), later(60).toISOString());
  assert.equal(first!.escalationLevel, 1); assert.equal(first!.escalationReason, 'SLA_BREACH');
  assert.equal(f.get().assignment.queue, 'LEGAL'); assert.equal(f.get().assignment.reason, 'Specialized review');
  const second = await evaluateResponseSLA({ userId: 'tenant-a', slaId: first!.id, now: later(90) }, f.db);
  assert.equal(second!.breachedAt!.toISOString(), later(60).toISOString());
  assert.equal(f.get().assignmentCreates, 0);
  await assert.rejects(() => evaluateResponseSLA({ userId: 'tenant-b', slaId: first!.id }, f.db), /not found for tenant/);
});

test('breach creates one safe human-review assignment when none exists', async () => {
  const f = fixture();
  await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: later(61) }, f.db);
  assert.equal(f.get().assignment.queue, 'HUMAN_REVIEW'); assert.equal(f.get().assignmentCreates, 1);
  await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: later(62) }, f.db);
  assert.equal(f.get().assignmentCreates, 1);
});

test('send and reject resolve; escalation and uncertain send remain open', async () => {
  const sent = fixture();
  await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: startedAt }, sent.db);
  sent.setAttempt('SENT');
  sent.setRisk({ decisionId: 'd1', status: 'NOT_APPLICABLE', score: null, band: null, confidence: 'HIGH' });
  assert.equal((await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: later(30) }, sent.db))!.status, 'RESOLVED');
  assert.equal(sent.get().sla.resolvedAt.toISOString(), later(20).toISOString());
  const rejected = fixture();
  await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: startedAt }, rejected.db);
  rejected.setRejection();
  assert.equal((await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: later(30) }, rejected.db))!.resolutionReason, 'HUMAN_REJECTED');
  const escalated = fixture(); escalated.setMode('MANDATORY_ESCALATION', 'ESCALATED');
  assert.equal((await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: startedAt }, escalated.db))!.status, 'ACTIVE');
  const uncertain = fixture(); uncertain.setMode('HUMAN_APPROVAL', 'FAILED_UNCERTAIN'); uncertain.setAttempt('FAILED_UNCERTAIN');
  assert.equal((await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: later(20) }, uncertain.db))!.status, 'ACTIVE');
  assert.equal(uncertain.get().sends, 0);
});

test('authoritative suppression and policy disable cancel without deleting history', async () => {
  const f = fixture();
  await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: startedAt }, f.db);
  f.setSuppression();
  const cancelled = await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: later(10) }, f.db);
  assert.equal(cancelled!.status, 'CANCELLED'); assert.equal(cancelled!.resolutionReason, 'CONFIRMED_SUPPRESSION');
  assert.equal((await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: later(60) }, f.db))!.status, 'CANCELLED');
  const disabled = fixture();
  await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: startedAt }, disabled.db);
  disabled.setPolicy({ enabled: false });
  assert.equal((await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: later(10) }, disabled.db))!.resolutionReason, 'SLA_POLICY_DISABLED');
});

test('risk not applicable and Autopilot success do not create human-response SLA', async () => {
  const nonRevenue = fixture(); nonRevenue.setDecision('READY', 'SPAM');
  assert.equal(await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: startedAt }, nonRevenue.db), null);
  const auto = fixture(); auto.setMode('AUTOPILOT', 'EXECUTED'); auto.setAttempt('SENT');
  assert.equal(await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: later(30) }, auto.db), null);
});

test('NEEDS_REVIEW and failed Autopilot transfer use persisted responsibility timestamps', async () => {
  const review = fixture(); review.setDecision('NEEDS_REVIEW'); review.setMode('AUTOPILOT', 'READY');
  const reviewSLA = await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: startedAt }, review.db);
  assert.equal(reviewSLA!.startedAt.toISOString(), startedAt.toISOString());
  const failed = fixture(); failed.setMode('AUTOPILOT', 'FAILED_UNCERTAIN'); failed.setAttempt('FAILED_UNCERTAIN', later(20));
  const failureSLA = await syncResponseSLAForDecision({ userId: 'tenant-a', decisionId: 'd1', now: later(20) }, failed.db);
  assert.equal(failureSLA!.startedAt.toISOString(), later(20).toISOString());
});

test('Inbox and action triggers use persisted facts with no provider calls', () => {
  const page = readFileSync(join(__dirname, '../src/app/dashboard/inbox-triage/page.tsx'), 'utf8');
  const action = readFileSync(join(__dirname, '../src/app/api/automation/actions/route.ts'), 'utf8');
  const service = readFileSync(join(__dirname, '../src/lib/response-sla/service.ts'), 'utf8');
  assert.match(page, /syncResponseSLAsBatch/); assert.match(action, /syncResponseSLAForDecision/);
  assert.doesNotMatch(service, /generateText|generateObject|Gemini|AIUsageEvent|fetch\(|sendNativeEmail/);
});
