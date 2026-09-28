import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrainKnowledgeCategory as C, BrainKnowledgeSource as S, BrainVerification as V, type PrismaClient } from '@prisma/client';
import { getOrCreateFrameLeadsBrain, rebuildBrainFromCanonicalSources, upsertBrainKnowledge,
  removeBrainKnowledge, getBrainKnowledge, getBrainContext, refreshBrainSummary } from '../src/lib/brain';

function fixture() {
  const users: Record<string, any> = { a: { id: 'a', rootBrandDomain: 'acme.example' }, b: { id: 'b', rootBrandDomain: null } };
  const profiles: Record<string, any> = { a: { id: 'icp-a', userId: 'a', targetTitles: ['VP Sales'], targetSeniorities: [], targetIndustries: ['B2B SaaS'],
    targetGeographies: [], excludedTitles: [], excludedIndustries: [], excludedDomains: [], requiredKeywords: [], excludedKeywords: [], companySizeMin: null, companySizeMax: null } };
  const roots: any[] = [], entries: any[] = []; let usage = 0;
  const tx: any = {
    user: { findUnique: async ({ where }: any) => users[where.id] || null },
    iCPProfile: { findUnique: async ({ where }: any) => profiles[where.userId] || null },
    frameLeadsBrain: {
      upsert: async ({ where, create }: any) => { let row = roots.find(r => r.userId === where.userId); if (!row) { row = { id: `brain-${where.userId}`, revision: 0, compactSummary: '', ...create }; roots.push(row); } return { ...row }; },
      findUnique: async ({ where }: any) => roots.find(r => r.userId === where.userId) || null,
      update: async ({ where, data }: any) => { const row = roots.find(r => r.userId === where.userId); if (data.revision) row.revision += data.revision.increment; if (data.compactSummary !== undefined) row.compactSummary = data.compactSummary; return { ...row }; },
    },
    brainKnowledgeEntry: {
      findMany: async ({ where, orderBy, take, cursor }: any) => {
        let rows = entries.filter(e => e.userId === where.userId && (where.brainId === undefined || e.brainId === where.brainId) &&
          (where.archivedAt === undefined || e.archivedAt === where.archivedAt) &&
          (!where.sourceType || where.sourceType.in.includes(e.sourceType)) &&
          (!where.category || where.category.in.includes(e.category)) &&
          (!where.verification || e.verification !== where.verification.not));
        if (cursor) rows = rows.slice(rows.findIndex(e => e.id === cursor.id) + 1);
        return rows.slice(0, take || rows.length).map(e => ({ ...e }));
      },
      findFirst: async ({ where }: any) => entries.find(e => e.userId === where.userId && (where.id === undefined || e.id === where.id) &&
        (where.category === undefined || e.category === where.category) && (where.key === undefined || e.key === where.key) &&
        (where.archivedAt === undefined || e.archivedAt === where.archivedAt)) || null,
      create: async ({ data }: any) => { const row = { id: `entry-${entries.length + 1}`, revision: 1, archivedAt: null, importance: 1,
        updatedAt: new Date(), ...data }; entries.push(row); return { ...row }; },
      update: async ({ where, data }: any) => { const row = entries.find(e => e.id === where.id); if (data.revision) row.revision += data.revision.increment;
        Object.assign(row, { ...data, revision: row.revision, updatedAt: new Date() }); return { ...row }; },
    },
    aIUsageEvent: { create: async () => { usage++; throw new Error('Brain must not record AI usage'); } },
  };
  const db = { ...tx, $transaction: async (work: any) => work(tx) } as PrismaClient;
  return { db, roots, entries, users, profiles, usage: () => usage };
}

test('tenant-owned Brain roots initialize once and cross-tenant knowledge stays isolated', async () => {
  const f = fixture();
  await getOrCreateFrameLeadsBrain('a', f.db); await getOrCreateFrameLeadsBrain('a', f.db);
  assert.equal(f.roots.length, 1);
  await upsertBrainKnowledge({ userId: 'a', category: C.PRODUCT, key: 'Capability', value: 'Native outbound' }, f.db);
  assert.equal((await getBrainKnowledge({ userId: 'b' }, f.db)).length, 0);
  await assert.rejects(upsertBrainKnowledge({ userId: 'b', id: f.entries[0].id, category: C.PRODUCT, key: 'Capability', value: 'Changed' }, f.db), /not found/);
  assert.equal(f.entries[0].value, 'Native outbound');
});

test('canonical seed is idempotent, read-only, and follows canonical changes', async () => {
  const f = fixture();
  const first = await rebuildBrainFromCanonicalSources('a', f.db);
  assert.equal(first.changed, true); assert.equal(first.revision, 1);
  assert.equal(f.entries.length, 3);
  assert.ok(f.entries.every(e => e.sourceType !== S.USER_ENTERED && e.verification === V.VERIFIED));
  const second = await rebuildBrainFromCanonicalSources('a', f.db);
  assert.equal(second.changed, false); assert.equal(second.revision, 1); assert.equal(f.entries.length, 3);
  await assert.rejects(upsertBrainKnowledge({ userId: 'a', id: f.entries[0].id, category: C.COMPANY, key: 'Root brand domain', value: 'other.example' }, f.db), /not found/);
  f.users.a.rootBrandDomain = 'new.example';
  await rebuildBrainFromCanonicalSources('a', f.db);
  assert.equal(f.entries.find(e => e.sourceKey === 'rootBrandDomain').value, 'new.example');
  assert.equal(f.roots[0].revision, 2);
});

test('manual CRUD preserves provenance, revision, bounded values and no-op reads', async () => {
  const f = fixture();
  const created = await upsertBrainKnowledge({ userId: 'a', category: C.PRICING, key: 'Core plan', value: '$147/month' }, f.db);
  assert.equal(created.sourceType, S.USER_ENTERED); assert.equal(created.verification, V.VERIFIED);
  assert.equal(f.roots[0].revision, 1);
  await upsertBrainKnowledge({ userId: 'a', id: created.id, category: C.PRICING, key: 'Core plan', value: '$147/month' }, f.db);
  assert.equal(f.roots[0].revision, 1);
  await getBrainKnowledge({ userId: 'a' }, f.db); await refreshBrainSummary('a', f.db);
  assert.equal(f.roots[0].revision, 1);
  const updated = await upsertBrainKnowledge({ userId: 'a', id: created.id, category: C.PRICING, key: 'Core plan', value: '$197/month' }, f.db);
  assert.equal(updated.revision, 2); assert.equal(f.roots[0].revision, 2);
  await assert.rejects(upsertBrainKnowledge({ userId: 'a', category: C.PRICING, key: 'Core plan', value: '$999/month' }, f.db), /Conflicting/);
  await assert.rejects(upsertBrainKnowledge({ userId: 'a', category: C.PRICING, key: 'x', value: 'a'.repeat(2300) }, f.db), /too long/);
  await removeBrainKnowledge({ userId: 'a', id: created.id }, f.db);
  assert.equal(f.roots[0].revision, 3); assert.equal((await getBrainKnowledge({ userId: 'a' }, f.db)).length, 0);
  assert.equal(f.usage(), 0);
});

test('purpose-aware retrieval favors relevant verified facts and stays bounded', async () => {
  const f = fixture();
  for (let i = 0; i < 25; i++) await upsertBrainKnowledge({ userId: 'a', category: i % 2 ? C.PRICING : C.PROOF,
    key: `Fact ${i}`, value: `Known detail ${i}` }, f.db);
  const context = await getBrainContext({ userId: 'a', purpose: 'pricing', maxEntries: 3, maxCharacters: 200 }, f.db);
  assert.equal(context.entries.length, 3); assert.ok(context.entries.every(e => e.category === C.PRICING));
  assert.ok(context.contextText.length <= 200);
  assert.ok(f.roots[0].compactSummary.length <= 1800);
  assert.equal(f.usage(), 0);
});

test('unverified and conflicted facts never masquerade as verified context', async () => {
  const f = fixture();
  await upsertBrainKnowledge({ userId: 'a', category: C.PRICING, key: 'Confirmed price', value: '$147/month' }, f.db);
  f.entries.push({ id: 'uncertain', userId: 'a', brainId: 'brain-a', category: C.PRICING, key: 'Rumored price', value: '$99/month',
    sourceType: S.USER_ENTERED, sourceKey: 'test:uncertain', verification: V.UNVERIFIED, importance: 3, archivedAt: null, updatedAt: new Date() });
  f.entries.push({ id: 'conflict', userId: 'a', brainId: 'brain-a', category: C.PRICING, key: 'Conflicting price', value: '$50/month',
    sourceType: S.USER_ENTERED, sourceKey: 'test:conflict', verification: V.CONFLICTED, importance: 3, archivedAt: null, updatedAt: new Date() });
  const context = await getBrainContext({ userId: 'a', purpose: 'pricing', maxEntries: 1 }, f.db);
  assert.equal(context.entries[0].key, 'Confirmed price');
  assert.equal(context.contextText.includes('Conflicting price'), false);
});

test('Brain routes derive tenancy from session and ignore client source ownership fields', () => {
  for (const route of ['src/app/api/brain/route.ts', 'src/app/api/brain/[id]/route.ts']) {
    const source = readFileSync(join(process.cwd(), route), 'utf8');
    assert.match(source, /resolveScoutUser/);
    assert.doesNotMatch(source, /body\.userId|body\.sourceType|body\.verification/);
  }
});
