import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recordDecisionOutcome, validateOutcomeInput } from '../src/lib/outcome-learning/outcomes';
import { deriveSLAObservation, getOutcomeLearningDashboard, refreshOutcomeLearnings,
  reviewLearningSuggestion } from '../src/lib/outcome-learning/learning';

const tenant = 'tenant-a';
const now = new Date();
const hourAgo = new Date(now.getTime() - 3_600_000);
const beforeDecision = new Date(now.getTime() - 7_200_000);

function outcomeFixture() {
  const outcomes: any[] = [], memories: any[] = [], writes: string[] = [];
  const db: any = {
    $transaction: async (work: any) => work(db),
    decision: { findFirst: async ({ where }: any) => where.userId === tenant && where.id === 'decision-a' ?
      { id: 'decision-a', prospectId: 'prospect-a', createdAt: beforeDecision, status: 'READY' } : null },
    decisionOutcome: {
      findUnique: async ({ where }: any) => outcomes.find(row => row.userId === where.userId_idempotencyKey.userId &&
        row.idempotencyKey === where.userId_idempotencyKey.idempotencyKey) ?? null,
      findFirst: async () => outcomes.at(-1) ?? null,
      create: async ({ data }: any) => { writes.push('decisionOutcome.create');
        const row = { id: `outcome-${outcomes.length + 1}`, createdAt: now, ...data }; outcomes.push(row); return row; },
    },
    prospect: { findUnique: async ({ where }: any) => where.userId_id.userId === tenant ? { id: 'prospect-a' } : null },
    prospectMemoryState: { upsert: async () => ({}), update: async () => { writes.push('prospectMemoryState.update'); return {}; } },
    prospectMemoryEvent: {
      createMany: async ({ data }: any) => { if (memories.some(row => row.sourceId === data[0].sourceId)) return { count: 0 };
        memories.push(data[0]); writes.push('prospectMemoryEvent.createMany'); return { count: 1 }; },
      findMany: async () => memories.map(row => ({ description: row.description })),
      findFirst: async () => memories.length ? { occurredAt: memories.at(-1).occurredAt } : null,
    },
  };
  return { db, outcomes, memories, writes };
}

function sample(breached: number, noBreach: number, positiveBreached: number, positiveNoBreach: number) {
  const rows: any[] = [];
  const make = (isBreached: boolean, index: number, positive: boolean) => ({
    id: `${isBreached ? 'b' : 'n'}-${index}`, decisionId: `decision-${isBreached ? 'b' : 'n'}-${index}`,
    revision: 1, outcomeType: positive ? 'MEETING_BOOKED' : 'LOST', occurredAt: hourAgo,
    decision: { responseSLA: { status: isBreached ? 'BREACHED' : 'RESOLVED',
      startedAt: beforeDecision, breachedAt: isBreached ? new Date(now.getTime() - 5_400_000) : null } },
  });
  for (let i = 0; i < breached; i++) rows.push(make(true, i, i < positiveBreached));
  for (let i = 0; i < noBreach; i++) rows.push(make(false, i, i < positiveNoBreach));
  return rows;
}

function learningFixture(rows: any[]) {
  const suggestions: any[] = [], writes: string[] = [];
  const db: any = {
    $transaction: async (work: any) => work(db),
    decisionOutcome: { findMany: async ({ where }: any) => { assert.equal(where.userId, tenant); return rows; } },
    learningSuggestion: {
      findUnique: async ({ where }: any) => suggestions.find(row => row.userId === where.userId_fingerprint.userId && row.fingerprint === where.userId_fingerprint.fingerprint) ?? null,
      findFirst: async ({ where }: any) => suggestions.find(row => row.userId === where.userId && row.status === where.status) ?? null,
      findMany: async ({ where }: any) => suggestions.filter(row => row.userId === where.userId && row.status === where.status),
      create: async ({ data }: any) => { writes.push('learningSuggestion.create');
        const row = { id: `suggestion-${suggestions.length + 1}`, status: 'OPEN', createdAt: now, ...data };
        suggestions.push(row); return row; },
      update: async ({ where, data }: any) => { writes.push('learningSuggestion.update');
        const row = suggestions.find(item => item.id === where.id); Object.assign(row, data); return row; },
      updateMany: async ({ where, data }: any) => { const matches = suggestions.filter(item =>
        (where.id == null || item.id === where.id) && item.userId === where.userId && item.status === where.status);
        if (!matches.length) return { count: 0 }; writes.push('learningSuggestion.updateMany');
        for (const row of matches) Object.assign(row, data); return { count: matches.length }; },
      findUniqueOrThrow: async ({ where }: any) => suggestions.find(item => item.id === where.id),
    },
    salesConstitution: { update: () => { throw new Error('Policy mutation forbidden'); } },
    revenuePlaybook: { update: () => { throw new Error('Playbook mutation forbidden'); } },
    frameLeadsBrain: { update: () => { throw new Error('Brain mutation forbidden'); } },
    aIUsageEvent: { create: () => { throw new Error('AI usage forbidden'); } },
  };
  return { db, suggestions, writes };
}

test('explicit human outcomes are tenant-owned, append-only and make one idempotent Memory event each', async () => {
  const f = outcomeFixture();
  const input = { userId: tenant, decisionId: 'decision-a', outcomeType: 'MEETING_BOOKED' as const,
    occurredAt: hourAgo, note: 'Confirmed by client.', idempotencyKey: 'request-0001' };
  const first = await recordDecisionOutcome(input, f.db);
  const reused = await recordDecisionOutcome(input, f.db);
  const corrected = await recordDecisionOutcome({ ...input, outcomeType: 'WON', idempotencyKey: 'request-0002' }, f.db);
  assert.equal(first.outcome.revision, 1); assert.equal(reused.reused, true);
  assert.equal(corrected.outcome.revision, 2); assert.equal(f.outcomes.length, 2);
  assert.equal(f.memories.length, 2); assert.deepEqual(f.memories.map(row => row.eventType), ['BUSINESS_OUTCOME', 'BUSINESS_OUTCOME']);
  await assert.rejects(() => recordDecisionOutcome({ ...input, outcomeType: 'WON' }, f.db), /different facts/);
  await assert.rejects(() => recordDecisionOutcome({ ...input, userId: 'tenant-b', idempotencyKey: 'request-0003' }, f.db), /not found for tenant/);
  assert.equal(f.outcomes.length, 2);
});

test('send/approval records alone do not create a business outcome', async () => {
  const f = outcomeFixture();
  assert.equal(f.outcomes.length, 0); assert.equal(f.memories.length, 0);
  assert.throws(() => validateOutcomeInput({ decisionId: 'decision-a', outcomeType: 'SENT',
    occurredAt: now, idempotencyKey: 'request-0004' }), /Invalid business outcome/);
  assert.throws(() => validateOutcomeInput({ decisionId: 'decision-a', outcomeType: 'WON',
    occurredAt: now, note: 'x'.repeat(501), idempotencyKey: 'request-0004' }), /Invalid business outcome/);
});

test('deterministic thresholds suppress tiny or incomplete comparisons', () => {
  const tiny = deriveSLAObservation(sample(4, 6, 0, 6), now);
  assert.equal(tiny.material, false); assert.equal(tiny.observedRate, null); assert.equal(tiny.comparisonRate, null);
  assert.equal(deriveSLAObservation(sample(5, 5, 2, 2), now).material, false);
  assert.equal(deriveSLAObservation(sample(5, 5, 0, 5), now, true).material, false);
  const enough = deriveSLAObservation(sample(5, 5, 0, 5), now);
  assert.equal(enough.eligibleCount, 10); assert.equal(enough.material, true);
  assert.equal(enough.observedRate, 0); assert.equal(enough.comparisonRate, 100);
  const ambiguous = sample(5, 5, 0, 5); ambiguous[0].outcomeType = 'OTHER';
  assert.equal(deriveSLAObservation(ambiguous, now).material, false);
});

test('adequate observed association creates one bounded, non-causal suggestion and repeat refresh does not spam', async () => {
  const f = learningFixture(sample(6, 6, 1, 5));
  const first = await refreshOutcomeLearnings(tenant, f.db, now);
  const second = await refreshOutcomeLearnings(tenant, f.db, now);
  assert.equal(first.created, true); assert.equal(second.created, false);
  assert.equal(f.suggestions.length, 1); assert.equal(f.suggestions[0].sampleSize, 12);
  assert.match(f.suggestions[0].explanation, /association, not evidence/);
  assert.doesNotMatch(f.suggestions[0].explanation, /will increase|proved|causes/i);
  const dashboard = await getOutcomeLearningDashboard(tenant, f.db, now);
  assert.equal(dashboard.suggestions.length, 1); assert.equal(dashboard.coverage.sufficient, true);
  assert.deepEqual(f.writes, ['learningSuggestion.create']);
});

test('aggregate reads and refresh remain tenant-scoped', async () => {
  const rows = sample(5, 5, 0, 5);
  const db: any = { decisionOutcome: { findMany: async ({ where }: any) => where.userId === tenant ? rows : [] },
    learningSuggestion: { findMany: async () => [], updateMany: async () => ({ count: 0 }) } };
  const other = await getOutcomeLearningDashboard('tenant-b', db, now);
  assert.equal(other.coverage.eligibleCount, 0);
  const result = await refreshOutcomeLearnings('tenant-b', db, now);
  assert.equal(result.suggestion, null);
});

test('accept/reject records actor and time without changing Brain, Playbook or Constitution', async () => {
  const f = learningFixture(sample(5, 5, 0, 5));
  const created = await refreshOutcomeLearnings(tenant, f.db, now);
  await assert.rejects(() => reviewLearningSuggestion({ userId: 'tenant-b', suggestionId: created.suggestion!.id,
    status: 'ACCEPTED_FOR_REVIEW' }, f.db), /not found for tenant/);
  const accepted = await reviewLearningSuggestion({ userId: tenant, suggestionId: created.suggestion!.id,
    status: 'ACCEPTED_FOR_REVIEW', note: 'Discuss with team.' }, f.db);
  assert.equal(accepted.status, 'ACCEPTED_FOR_REVIEW'); assert.equal(accepted.reviewedById, tenant);
  assert.ok(accepted.reviewedAt instanceof Date);
  assert.equal(accepted.reviewNote, 'Discuss with team.');
  const duplicate = await refreshOutcomeLearnings(tenant, f.db, now);
  assert.equal(duplicate.created, false); assert.equal(f.suggestions.length, 1);
  await assert.rejects(() => reviewLearningSuggestion({ userId: tenant, suggestionId: accepted.id,
    status: 'REJECTED' }, f.db), /not found for tenant/);
  assert.deepEqual(f.writes, ['learningSuggestion.create', 'learningSuggestion.updateMany']);
  const g = learningFixture(sample(5, 5, 0, 5));
  const toReject = await refreshOutcomeLearnings(tenant, g.db, now);
  const rejected = await reviewLearningSuggestion({ userId: tenant, suggestionId: toReject.suggestion!.id,
    status: 'REJECTED' }, g.db);
  assert.equal(rejected.status, 'REJECTED');
});

test('explicit refresh archives an open observation when corrected evidence falls below minimum', async () => {
  const rows = sample(5, 5, 0, 5);
  const f = learningFixture(rows);
  await refreshOutcomeLearnings(tenant, f.db, now);
  rows.splice(0, 2);
  const result = await refreshOutcomeLearnings(tenant, f.db, now);
  assert.equal(result.reason, 'INSUFFICIENT_EVIDENCE');
  assert.equal(f.suggestions[0].status, 'ARCHIVED');
  assert.equal((await getOutcomeLearningDashboard(tenant, f.db, now)).suggestions.length, 0);
});

test('learning uses zero AI/provider calls and never writes protected policy records', () => {
  const source = ['outcomes.ts', 'learning.ts'].map(file => readFileSync(require.resolve(`../src/lib/outcome-learning/${file}`), 'utf8')).join('\n');
  assert.doesNotMatch(source, /gemini|anthropic|openai|recordAIUsage|sendNativeEmail|runAutopilot/i);
  assert.doesNotMatch(source, /\.(salesConstitution|revenuePlaybook|frameLeadsBrain|iCPProfile|automationPolicy|responseSLAPolicy)\.(create|update|upsert)/);
});
