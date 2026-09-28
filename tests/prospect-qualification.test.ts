import { test } from 'node:test';
import { installMemoryFixture } from './memory-fixture';
import assert from 'node:assert/strict';
import { ICPQualificationPolicy, ProspectQualificationStatus, ProspectResearchStatus, type ICPProfile, type PrismaClient } from '@prisma/client';
import { evaluateICP, qualifyProspect, qualifyProspectsBatch, saveICPProfile } from '../src/lib/prospects/qualification';
import { researchProspectICP } from '../src/lib/prospects/research';

const profile = (rules: Partial<ICPProfile> = {}): ICPProfile => ({
  id: 'icp-a', userId: 'tenant-a', name: 'Default ICP', isActive: true, qualificationPolicy: ICPQualificationPolicy.CONSERVATIVE,
  targetTitles: [], targetSeniorities: [], targetIndustries: [], targetGeographies: [],
  excludedTitles: [], excludedIndustries: [], excludedDomains: [],
  companySizeMin: null, companySizeMax: null, requiredKeywords: [], excludedKeywords: [],
  createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-02'), ...rules,
});
const context = (incidentDetails: string[] = [], websiteUrl: string | null = null) => ({ incidentDetails, websiteUrl });

test('B/C: hard exclusions reject known domains and titles', () => {
  assert.equal(evaluateICP(profile({ excludedDomains: ['competitor.com'] }), context([], 'https://www.competitor.com')).status, 'REJECTED');
  assert.equal(evaluateICP(profile({ excludedTitles: ['VP Sales'] }), context(['Title: Vice President of Sales'])).status, 'REJECTED');
  assert.equal(evaluateICP(profile({ excludedKeywords: ['outsourcing'] }), context(['Keywords: outsourcing, agency'])).status, 'REJECTED');
  assert.equal(evaluateICP(profile({ excludedKeywords: ['outsourcing'] }), context(['We do not use outsourcing.'])).status, 'NEEDS_REVIEW');
});

test('D/E/F/G/H: positives, missing facts, empty ICP, and company size are deterministic', () => {
  assert.equal(evaluateICP(profile({ targetTitles: ['VP Sales'] }), context(['Title: Vice President of Sales'])).status, 'QUALIFIED');
  assert.equal(evaluateICP(profile({ targetIndustries: ['B2B SaaS'] }), context()).status, 'NEEDS_REVIEW');
  assert.equal(evaluateICP(profile(), context(['Title: VP Sales'])).status, 'NEEDS_REVIEW');
  assert.equal(evaluateICP(profile({ companySizeMin: 50 }), context()).status, 'NEEDS_REVIEW');
  assert.equal(evaluateICP(profile({ companySizeMin: 50, companySizeMax: 500 }), context(['Employees: 20'])).status, 'NEEDS_REVIEW');
  assert.equal(evaluateICP(profile({ targetTitles: ['VP Sales'], requiredKeywords: ['outbound'] }), context(['Title: VP Sales'])).status, 'NEEDS_REVIEW');
});

test('A/N: tenant-owned profile and qualification queries cannot cross tenants', async () => {
  const known = context(['Title: VP Sales']);
  assert.equal(evaluateICP(profile({ userId: 'tenant-a', targetTitles: ['VP Sales'] }), known).status, 'QUALIFIED');
  assert.equal(evaluateICP(profile({ userId: 'tenant-b', excludedTitles: ['VP Sales'] }), known).status, 'REJECTED');
  const queries: unknown[] = [];
  const db = {
    prospect: { findUnique: async (query: unknown) => { queries.push(query); return null; } },
    iCPProfile: { findUnique: async (query: unknown) => { queries.push(query); return profile(); } },
  };
  await assert.rejects(qualifyProspect({ userId: 'tenant-b', prospectId: 'tenant-a-prospect' }, db as never), /not found/);
  assert.deepEqual((queries[0] as { where: unknown }).where, { userId_id: { userId: 'tenant-b', id: 'tenant-a-prospect' } });
  await assert.rejects(qualifyProspect({ userId: 'tenant-a', prospectId: 'p1', icpProfileId: 'tenant-b-profile' }, {
    prospect: { findUnique: async () => ({ id: 'p1', websiteUrl: null }) }, iCPProfile: { findUnique: async () => profile() },
  } as never), /not found/);
});

function gateDb(ready = false) {
  const intelligence = ready ? { id: 'intel', userId: 'tenant-a', prospectId: 'p1', researchStatus: ProspectResearchStatus.READY } : null;
  return {
    prospect: { findUnique: async ({ where }: any) => where.userId_id.userId === 'tenant-a' && where.userId_id.id === 'p1' ? { id: 'p1', userId: 'tenant-a', companyName: 'Acme', createdAt: new Date() } : null },
    prospectIntelligence: { findUnique: async () => intelligence },
    prospectEvidence: { count: async () => 0 },
  } as unknown as PrismaClient;
}

test('I/J: REJECTED and NEEDS_REVIEW produce zero Gemini calls', async () => {
  for (const status of [ProspectQualificationStatus.REJECTED, ProspectQualificationStatus.NEEDS_REVIEW]) {
    let calls = 0;
    const result = await researchProspectICP({ userId: 'tenant-a', prospectId: 'p1' }, {
      db: gateDb(),
      qualify: async () => ({ status, qualificationReason: 'Deterministic gate' }) as never,
      provider: { analyze: async () => { calls++; throw new Error('Must not call Gemini'); } },
    });
    assert.equal(calls, 0);
    assert.equal(result.status, status === 'REJECTED' ? 'NOT_ELIGIBLE' : 'QUALIFICATION_REQUIRED');
  }
});

test('L: valid READY result is reused before qualification and Gemini', async () => {
  let qualifyCalls = 0; let geminiCalls = 0;
  const result = await researchProspectICP({ userId: 'tenant-a', prospectId: 'p1' }, {
    db: gateDb(true),
    qualify: async () => { qualifyCalls++; throw new Error('Should reuse'); },
    provider: { analyze: async () => { geminiCalls++; throw new Error('Should reuse'); } },
  });
  assert.equal(result.reused, true);
  assert.equal(qualifyCalls, 0);
  assert.equal(geminiCalls, 0);
});

test('K/M: qualified and explicit override pass the gate; cross-tenant research is rejected first', async () => {
  const db = gateDb();
  await assert.rejects(researchProspectICP({ userId: 'tenant-b', prospectId: 'p1' }, { db, qualify: async () => { throw new Error('Should not qualify'); } }), /not found/);
  // The minimal DB mock has no lease methods. Reaching those methods proves the gate allowed the full path.
  await assert.rejects(researchProspectICP({ userId: 'tenant-a', prospectId: 'p1' }, { db, qualify: async () => ({ status: 'QUALIFIED' }) as never }), /create/);
  await assert.rejects(researchProspectICP({ userId: 'tenant-a', prospectId: 'p1', overrideQualification: true }, { db, qualify: async () => { throw new Error('Override should skip qualification'); } }), /create/);
});

test('O: batch qualifies in pages with tenant scope and no AI or network adapter', async () => {
  const updated = new Map<string, any>();
  const ids = ['p1', 'p2', 'p3'];
  const db = {
    iCPProfile: { upsert: async () => profile({ targetTitles: ['VP Sales'] }) },
    prospect: {
      findMany: async ({ where, cursor, take }: any) => {
        assert.equal(where.userId, 'tenant-a');
        const start = cursor ? ids.indexOf(cursor.id) + 1 : 0;
        return ids.slice(start, start + take).map(id => ({ id, websiteUrl: null, generatedLeads: [{ incidentDetails: id === 'p3' ? null : 'Title: VP Sales' }] }));
      },
      findUnique: async ({ where }: any) => ({ id: where.userId_id.id, websiteUrl: null }),
    },
    prospectQualification: {
      findUnique: async ({ where }: any) => updated.get(where.userId_prospectId.prospectId) || null,
      create: async ({ data }: any) => { updated.set(data.prospectId, { ...data, override: 'AUTO' }); return updated.get(data.prospectId); },
      updateMany: async ({ where, data }: any) => { const row = updated.get(where.prospectId); if (!row || row.override !== 'AUTO') return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
    },
  };
  installMemoryFixture(db);
  (db as any).$transaction = async (work: any) => work(db);
  const result = await qualifyProspectsBatch({ userId: 'tenant-a', pageSize: 2 }, db as never);
  assert.deepEqual(result, { processed: 3, qualified: 2, rejected: 0, needsReview: 1, nextCursor: null });
  assert.deepEqual([...updated.keys()], ids);
  const firstPage = await qualifyProspectsBatch({ userId: 'tenant-a', pageSize: 2, maxPages: 1 }, db as never);
  assert.equal(firstPage.nextCursor, 'p2');
  const secondPage = await qualifyProspectsBatch({ userId: 'tenant-a', pageSize: 2, maxPages: 1, cursor: firstPage.nextCursor! }, db as never);
  assert.equal(secondPage.processed, 1);
  assert.equal(secondPage.nextCursor, null);
});

test('profile saves are tenant-scoped and reject an inverted size range', async () => {
  const db = { iCPProfile: { findUnique: async () => null, upsert: async ({ where, create }: any) => { assert.deepEqual(where, { userId: 'tenant-a' }); return create; } } };
  await assert.rejects(saveICPProfile(db as never, 'tenant-a', { companySizeMin: 500, companySizeMax: 50 }), /inverted/);
  const saved = await saveICPProfile(db as never, 'tenant-a', { targetTitles: ['VP Sales'] });
  assert.deepEqual(saved.targetTitles, ['VP Sales']);
});
