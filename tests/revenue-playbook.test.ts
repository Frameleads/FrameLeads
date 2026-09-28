import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RevenueScenario as S, RevenuePlaybookSource as Source, type PrismaClient } from '@prisma/client';
import { archivePlaybookRule, createPlaybookRule, getOrCreateRevenuePlaybook, getPlaybookContext,
  getPlaybookRevision, listPlaybookRules, updatePlaybookRule, validatePlaybookRule } from '../src/lib/revenue-playbook';

const base = { name: 'Price inquiry', scenario: S.PRICING, objective: 'Understand the pricing concern.',
  guidance: 'Answer the price question directly and connect it to the stated use case.',
  nextAction: 'Ask whether budget or timing is the main concern.' };
function fixture() {
  const roots: any[] = [], rules: any[] = [];
  let usage = 0;
  const tx: any = {
    user: { findUnique: async ({ where }: any) => ['a', 'b'].includes(where.id) ? { id: where.id } : null },
    revenuePlaybook: {
      upsert: async ({ where, create }: any) => { let row = roots.find(p => p.userId === where.userId); if (!row) { row = { id: `p-${where.userId}`, revision: 0, name: 'Default Revenue Playbook', ...create }; roots.push(row); } return { ...row }; },
      update: async ({ where, data }: any) => { const row = roots.find(p => p.userId === where.userId); row.revision += data.revision.increment; return { ...row }; },
    },
    revenuePlaybookRule: {
      create: async ({ data }: any) => { const row = { id: `r${rules.length + 1}`, revision: 1, archivedAt: null, updatedAt: new Date(),
        sourceKey: null, ...data }; rules.push(row); return { ...row }; },
      findFirst: async ({ where }: any) => rules.find(r => r.userId === where.userId && r.id === where.id &&
        (where.archivedAt === undefined || r.archivedAt === where.archivedAt)) || null,
      update: async ({ where, data }: any) => { const row = rules.find(r => r.id === where.id); if (data.revision) row.revision += data.revision.increment;
        Object.assign(row, { ...data, revision: row.revision, updatedAt: new Date() }); return { ...row }; },
      findMany: async ({ where, take }: any) => rules.filter(r => r.userId === where.userId &&
        (where.playbookId === undefined || r.playbookId === where.playbookId) &&
        (where.enabled === undefined || r.enabled === where.enabled) &&
        (where.archivedAt === undefined || r.archivedAt === where.archivedAt) &&
        (!where.scenario || where.scenario.in.includes(r.scenario)) &&
        (!where.AND || where.AND.every((clause: any) => clause.OR ? clause.OR.some((v: any) => Object.entries(v).every(([key, value]) => r[key] === value)) : Object.entries(clause).every(([key, value]) => r[key] === value)))
        ).slice(0, take || rules.length).map(r => ({ ...r })),
    },
    aIUsageEvent: { create: async () => { usage++; throw new Error('No AI usage allowed'); } },
  };
  const db = { ...tx, $transaction: async (work: any) => work(tx) } as PrismaClient;
  return { db, roots, rules, usage: () => usage };
}

test('one tenant-owned root, isolated reads, mutations and context', async () => {
  const f = fixture();
  await getOrCreateRevenuePlaybook('a', f.db); await getOrCreateRevenuePlaybook('a', f.db);
  assert.equal(f.roots.length, 1);
  const rule = await createPlaybookRule({ userId: 'a', ...base }, f.db);
  assert.equal((await listPlaybookRules({ userId: 'b' }, f.db)).length, 0);
  await assert.rejects(listPlaybookRules({ userId: 'b', cursor: rule.id }, f.db), /cursor not found/);
  assert.equal((await getPlaybookContext({ userId: 'b', scenarios: [S.PRICING] }, f.db)).rules.length, 0);
  await assert.rejects(updatePlaybookRule({ userId: 'b', id: rule.id, ...base }, f.db), /not found/);
  await assert.rejects(archivePlaybookRule({ userId: 'b', id: rule.id }, f.db), /not found/);
  assert.equal(f.rules[0].userId, 'a');
});

test('rule CRUD, provenance, validation and revisions reflect effective guidance only', async () => {
  const f = fixture();
  const created = await createPlaybookRule({ userId: 'a', ...base, responsePrinciples: ['Answer directly'] }, f.db);
  assert.equal(created.source, Source.USER_ENTERED); assert.equal(f.roots[0].revision, 1);
  assert.equal(await getPlaybookRevision('a', f.db), 1);
  await updatePlaybookRule({ userId: 'a', id: created.id, ...base, responsePrinciples: ['Answer directly'] }, f.db);
  assert.equal(f.roots[0].revision, 1);
  await updatePlaybookRule({ userId: 'a', id: created.id, ...base, responsePrinciples: ['Answer directly'], priority: 3 }, f.db);
  assert.equal(f.roots[0].revision, 2); assert.equal(f.rules[0].revision, 2);
  await updatePlaybookRule({ userId: 'a', id: created.id, ...base, responsePrinciples: ['Answer directly'], priority: 3, enabled: false }, f.db);
  assert.equal(f.roots[0].revision, 3);
  await archivePlaybookRule({ userId: 'a', id: created.id }, f.db);
  assert.equal(f.roots[0].revision, 3);
  assert.equal(await archivePlaybookRule({ userId: 'a', id: created.id }, f.db), false);
  assert.equal((await listPlaybookRules({ userId: 'a' }, f.db)).length, 0);
  assert.equal(f.usage(), 0);
  assert.throws(() => validatePlaybookRule({ ...base, guidance: 'x'.repeat(3001) }), /too long/);
  assert.throws(() => validatePlaybookRule({ ...base, scenario: S.CUSTOM }), /Custom scenario/);
  assert.throws(() => validatePlaybookRule({ ...base, priority: 4 }), /Priority/);
});

test('scenario and purpose selection are deterministic, bounded, and exclude inactive guidance', async () => {
  const f = fixture();
  await createPlaybookRule({ userId: 'a', ...base, name: 'General', scenario: S.GENERAL, priority: 3 }, f.db);
  await createPlaybookRule({ userId: 'a', ...base, name: 'Price', scenario: S.PRICING, priority: 1 }, f.db);
  await createPlaybookRule({ userId: 'a', ...base, name: 'Budget', scenario: S.BUDGET, priority: 3 }, f.db);
  await createPlaybookRule({ userId: 'a', ...base, name: 'Disabled', scenario: S.PRICING, enabled: false }, f.db);
  const first = await getPlaybookContext({ userId: 'a', purpose: 'pricing', scenarios: [S.PRICING], maxRules: 2, maxCharacters: 1000 }, f.db);
  const again = await getPlaybookContext({ userId: 'a', purpose: 'pricing', scenarios: [S.PRICING], maxRules: 2, maxCharacters: 1000 }, f.db);
  assert.equal(first.rules.length, 2);
  assert.equal(first.rules[0].scenario, S.PRICING);
  assert.equal(first.contextText, again.contextText);
  assert.ok(first.contextText.length <= 1000);
  assert.ok(!first.contextText.includes('Disabled'));
  const small = await getPlaybookContext({ userId: 'a', scenarios: [S.PRICING], maxRules: 1, maxCharacters: 200 }, f.db);
  assert.ok(small.rules.length <= 1 && small.contextText.length <= 200);
});

test('conditional applicability is simple and source provenance cannot be forged from routes', async () => {
  const f = fixture();
  await createPlaybookRule({ userId: 'a', ...base, qualificationCondition: 'QUALIFIED', direction: 'INBOUND' }, f.db);
  assert.equal((await getPlaybookContext({ userId: 'a', scenarios: [S.PRICING] }, f.db)).rules.length, 0);
  assert.equal((await getPlaybookContext({ userId: 'a', scenarios: [S.PRICING], qualificationStatus: 'QUALIFIED', direction: 'INBOUND' }, f.db)).rules.length, 1);
  assert.equal((await getPlaybookContext({ userId: 'a', scenarios: [S.PRICING], qualificationStatus: 'REJECTED', direction: 'INBOUND' }, f.db)).rules.length, 0);
  for (const path of ['src/app/api/playbook/rules/route.ts', 'src/app/api/playbook/rules/[id]/route.ts']) {
    const source = readFileSync(join(process.cwd(), path), 'utf8');
    assert.match(source, /resolveScoutUser/);
    assert.doesNotMatch(source, /body\.userId|body\.source|body\.sourceKey/);
  }
  assert.equal(f.usage(), 0);
});

test('explicit scenario keeps retrieval capacity when generic guidance exceeds candidate cap', async () => {
  const f = fixture();
  for (let i = 0; i < 110; i++) f.rules.push({ id: `generic-${i}`, userId: 'a', playbookId: 'p-a',
    ...base, name: `Generic ${i}`, scenario: S.GENERAL, priority: 3, enabled: true, archivedAt: null,
    qualificationCondition: null, direction: null, responsePrinciples: [], ctaGuidance: null,
    source: Source.USER_ENTERED, updatedAt: new Date() });
  const price = await createPlaybookRule({ userId: 'a', ...base, priority: 1 }, f.db);
  const result = await getPlaybookContext({ userId: 'a', purpose: 'pricing', scenarios: [S.PRICING], maxRules: 1 }, f.db);
  assert.equal(result.rules[0].id, price.id);
});

test('Playbook does not import Brain or Prospect Memory or make provider calls', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/revenue-playbook.ts'), 'utf8');
  assert.doesNotMatch(source, /from ['"].*brain|from ['"].*memory|gemini|anthropic|openai|aIUsageEvent/i);
});
