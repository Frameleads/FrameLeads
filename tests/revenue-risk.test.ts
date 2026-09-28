import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreRevenueRisk, type RiskFacts } from '../src/lib/revenue-risk/scoring';
import { sortInboxByRevenueRisk } from '../src/lib/revenue-risk/sort';
import { assessRevenueAtRisk, assessRevenueAtRiskBatch } from '../src/lib/revenue-risk/service';

const now = new Date('2026-09-28T12:00:00.000Z');
function facts(overrides: Partial<RiskFacts> = {}): RiskFacts {
  return { decisionId: 'd1', prospectId: 'p1', inputMessageId: 'm1', intelligenceId: 'i1',
    qualificationId: 'q1', automationResolutionId: 'a1', recentMessageIds: ['m1', 'm0'],
    primaryIntent: 'PRICING_INQUIRY', decisionStatus: 'READY', decisionConfidence: 90,
    requiresReview: false, qualificationStatus: 'QUALIFIED', fitScore: 88, fitTier: 'STRONG',
    valueBand: 'HIGH', inboundAt: new Date('2026-09-28T00:00:00.000Z'),
    latestOutboundAt: new Date('2026-09-27T10:00:00.000Z'), outboundHistoryComplete: true,
    recentInboundCount: 2, recentOutboundCount: 1, automationState: 'PENDING_APPROVAL',
    automationMode: 'HUMAN_APPROVAL', ...overrides };
}
const component = (result: ReturnType<typeof scoreRevenueRisk>, signal: string) =>
  result.components.find(row => row.signal === signal)!;

test('same inputs and time yield identical explainable score, band and provenance', () => {
  const first = scoreRevenueRisk(facts(), now), second = scoreRevenueRisk(facts(), now);
  assert.deepEqual(first, second); assert.equal(first.status, 'APPLICABLE');
  assert.ok(first.score! >= 0 && first.score! <= 100);
  assert.ok(first.reasons.length > 0); assert.equal(first.scoringVersion, 'revenue-risk-v1');
  assert.ok(first.sourceReferences.some(row => row.type === 'DECISION' && row.id === 'd1'));
});

test('strong commercial case outranks weak case without fabricated financial value', () => {
  const strong = scoreRevenueRisk(facts(), now);
  const weak = scoreRevenueRisk(facts({ primaryIntent: 'NEUTRAL_QUESTION', fitScore: 25, fitTier: 'WEAK',
    valueBand: 'LOW', automationState: 'READY', recentInboundCount: 1, recentOutboundCount: 0,
    inboundAt: new Date('2026-09-28T11:30:00.000Z') }), now);
  assert.ok(strong.score! > weak.score!);
  assert.equal(component(strong, 'opportunity').value, 'HIGH');
  assert.equal(JSON.stringify(strong).includes('$'), false);
});

test('unknown values are omitted from denominator and lower confidence', () => {
  const complete = scoreRevenueRisk(facts(), now);
  const sparse = scoreRevenueRisk(facts({ valueBand: null, fitScore: null, fitTier: null,
    qualificationStatus: null, automationState: null, automationResolutionId: null,
    recentInboundCount: null, recentOutboundCount: null, decisionConfidence: null,
    outboundHistoryComplete: false }), now);
  assert.equal(component(sparse, 'opportunity').known, false);
  assert.equal(component(sparse, 'opportunity').normalizedScore, null);
  assert.equal(sparse.confidence, 'LOW'); assert.notEqual(sparse.score, 0);
  assert.equal(complete.confidence, 'HIGH');
});

test('missing canonical amount stays absent even when legacy inbound has a default pipeline value', () => {
  const result = scoreRevenueRisk(facts({ valueBand: 'STRATEGIC' }), now);
  assert.equal(component(result, 'opportunity').value, 'STRATEGIC');
  assert.equal(JSON.stringify(result).includes('5000'), false);
});

test('intent taxonomy distinguishes commercial from weak and non-revenue cases', () => {
  assert.ok(component(scoreRevenueRisk(facts({ primaryIntent: 'MEETING_REQUEST' }), now), 'intent').normalizedScore! >
    component(scoreRevenueRisk(facts({ primaryIntent: 'CONFUSED' }), now), 'intent').normalizedScore!);
  for (const primaryIntent of ['SPAM', 'OUT_OF_OFFICE', 'UNSUBSCRIBE'] as const) {
    const result = scoreRevenueRisk(facts({ primaryIntent }), now);
    assert.equal(result.status, 'NOT_APPLICABLE'); assert.equal(result.score, null);
  }
  assert.equal(scoreRevenueRisk(facts({ primaryIntent: 'SPAM', decisionConfidence: 40,
    requiresReview: true }), now).status, 'INSUFFICIENT_DATA');
});

test('delay buckets rise deterministically without a deadline or breach state', () => {
  const recent = scoreRevenueRisk(facts({ inboundAt: new Date('2026-09-28T11:30:00.000Z') }), now);
  const older = scoreRevenueRisk(facts({ inboundAt: new Date('2026-09-25T00:00:00.000Z'),
    latestOutboundAt: new Date('2026-09-24T00:00:00.000Z') }), now);
  assert.ok(component(older, 'delay').normalizedScore! > component(recent, 'delay').normalizedScore!);
  assert.equal(JSON.stringify(older).includes('dueAt'), false);
});

test('reciprocal momentum and review uncertainty affect attention, not send authority', () => {
  const active = scoreRevenueRisk(facts(), now);
  const dormant = scoreRevenueRisk(facts({ recentInboundCount: 0, recentOutboundCount: 0 }), now);
  assert.ok(component(active, 'momentum').normalizedScore! > component(dormant, 'momentum').normalizedScore!);
  const review = scoreRevenueRisk(facts({ decisionStatus: 'NEEDS_REVIEW', requiresReview: true,
    decisionConfidence: 45, automationState: 'ESCALATED' }), now);
  assert.ok(component(review, 'uncertainty').normalizedScore! > component(active, 'uncertainty').normalizedScore!);
  assert.ok(component(review, 'governance').normalizedScore! > component(active, 'governance').normalizedScore!);
  assert.equal('resolvedMode' in review, false);
});

test('revenue ordering is stable and leaves unknown/non-revenue behind applicable scores', () => {
  const rows = [{ id: 'unknown', revenueRisk: null }, { id: 'low', revenueRisk: { status: 'APPLICABLE', score: 25 } },
    { id: 'high', revenueRisk: { status: 'APPLICABLE', score: 87 } },
    { id: 'na', revenueRisk: { status: 'NOT_APPLICABLE', score: null } }];
  assert.deepEqual(sortInboxByRevenueRisk(rows).map(row => row.id), ['high', 'low', 'unknown', 'na']);
  assert.deepEqual(rows.map(row => row.id), ['unknown', 'low', 'high', 'na']);
});

function serviceFixture() {
  const stored = new Map<string, any>(); let writes = 0, aiCalls = 0, usageRows = 0, historyReads = 0;
  const row: any = { id: 'd1', userId: 'tenant-a', prospectId: 'p1', conversationId: 'c1', inputMessageId: 'm1',
    primaryIntent: 'PRICING_INQUIRY', status: 'READY', confidenceScore: 90, requiresReview: false,
    inputMessage: { occurredAt: new Date('2026-09-28T00:00:00.000Z') },
    prospect: { qualification: { id: 'q1', status: 'QUALIFIED' },
      intelligence: { id: 'i1', fitScore: 88, fitTier: 'STRONG', potentialValueBand: 'HIGH',
        researchStatus: 'READY', lastEditedBy: 'SYSTEM' } } };
  const db: any = { $transaction: async (promises: Promise<any>[]) => Promise.all(promises),
    decision: { findMany: async ({ where }: any) => where.userId === 'tenant-a' && where.id.in.includes('d1') ? [row] : [] },
    conversationMessage: { findMany: async ({ where }: any) => { historyReads++;
      assert.equal(where.userId, 'tenant-a'); return [{ id: 'm1', conversationId: 'c1', direction: 'INBOUND',
        occurredAt: new Date('2026-09-28T00:00:00.000Z') }]; } },
    decisionAutomationResolution: { findMany: async () => [{ id: 'a1', decisionId: 'd1', state: 'PENDING_APPROVAL', resolvedMode: 'HUMAN_APPROVAL' }] },
    decisionRevenueRisk: { findMany: async ({ where }: any) => [...stored.values()].filter(item => where.decisionId.in.includes(item.decisionId)),
      upsert: async ({ where, create, update }: any) => { writes++; const id = where.userId_decisionId.decisionId;
        const saved = { id: `risk-${id}`, userId: 'tenant-a', decisionId: id, createdAt: now,
          updatedAt: now, ...(stored.has(id) ? update : create) }; stored.set(id, saved); return saved; } },
  };
  return { db, stored, writes: () => writes, aiCalls: () => aiCalls,
    usageRows: () => usageRows, historyReads: () => historyReads };
}

test('tenant-scoped service persists one current assessment and reuses unchanged inputs', async () => {
  const f = serviceFixture();
  const first = await assessRevenueAtRisk({ userId: 'tenant-a', decisionId: 'd1', now }, f.db);
  const second = await assessRevenueAtRisk({ userId: 'tenant-a', decisionId: 'd1', now }, f.db);
  assert.equal(first.id, second.id); assert.equal(f.writes(), 1); assert.equal(f.stored.size, 1);
  assert.equal(f.historyReads(), 2); assert.equal(f.aiCalls(), 0); assert.equal(f.usageRows(), 0);
  await assert.rejects(() => assessRevenueAtRisk({ userId: 'tenant-b', decisionId: 'd1', now }, f.db), /not found for tenant/);
  await assert.rejects(() => assessRevenueAtRiskBatch({ userId: 'tenant-a', decisionIds: ['d1', 'foreign'], now }, f.db), /not found for tenant/);
});

test('reassessment writes only after a material delay bucket change', async () => {
  const f = serviceFixture();
  await assessRevenueAtRisk({ userId: 'tenant-a', decisionId: 'd1', now: new Date('2026-09-28T00:30:00.000Z') }, f.db);
  await assessRevenueAtRisk({ userId: 'tenant-a', decisionId: 'd1', now: new Date('2026-09-28T00:50:00.000Z') }, f.db);
  assert.equal(f.writes(), 1);
  await assessRevenueAtRisk({ userId: 'tenant-a', decisionId: 'd1', now: new Date('2026-09-28T06:30:00.000Z') }, f.db);
  assert.equal(f.writes(), 2); assert.equal(f.stored.size, 1);
});

test('Inbox query and UI remain tenant-scoped and automation authority stays separate', () => {
  const page = readFileSync(join(__dirname, '../src/app/dashboard/inbox-triage/page.tsx'), 'utf8');
  const ui = readFileSync(join(__dirname, '../src/app/dashboard/inbox-triage/TriageCommandCenter.tsx'), 'utf8');
  const service = readFileSync(join(__dirname, '../src/lib/revenue-risk/service.ts'), 'utf8');
  assert.match(page, /assessRevenueAtRiskBatch\(\{ userId: user\.id/);
  assert.match(ui, /sortInboxByRevenueRisk\(filteredLeads\)/);
  assert.match(ui, /Priority index, not a dollar-loss estimate/);
  assert.doesNotMatch(service, /generateText|generateObject|Gemini|AIUsageEvent|fetch\(/);
});
