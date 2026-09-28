import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ICPQualificationPolicy, type Company, type ICPProfile, type PrismaClient } from '@prisma/client';
import { companyInputFingerprint, companySources, getOrResearchCompany, icpInputFingerprint } from '../src/lib/prospects/company-research';
import { validateResearchOutput } from '../src/lib/prospects/research';
import type { ResearchProvider } from '../src/lib/prospects/research-provider';

const date = new Date('2026-09-28T00:00:00Z');
const company = (userId = 'tenant-a'): Company => ({
  id: `company-${userId}`, userId, name: 'Acme', normalizedName: 'acme',
  websiteUrl: 'https://acme.example', normalizedDomain: 'acme.example',
  industry: 'B2B SaaS', companySizeMin: 51, companySizeMax: 200,
  createdAt: date, updatedAt: date,
});
const profile = (userId = 'tenant-a'): ICPProfile => ({
  id: `icp-${userId}`, userId, name: 'ICP', isActive: true, qualificationPolicy: ICPQualificationPolicy.CONSERVATIVE,
  targetTitles: ['VP Sales'], targetSeniorities: [], targetIndustries: ['B2B SaaS'], targetGeographies: [],
  excludedTitles: [], excludedIndustries: [], excludedDomains: [], companySizeMin: 50, companySizeMax: 500,
  requiredKeywords: [], excludedKeywords: [], createdAt: date, updatedAt: date,
});
function output(id: string) {
  const claim = 'Company industry: B2B SaaS.';
  return {
    confidenceScore: 80, whyFit: 'The supplied B2B SaaS industry matches the configured ICP.', whyFitEvidenceIds: [id],
    whyNow: null, whyNowEvidenceIds: [], triggers: [], risks: [], potentialValueBand: null, valueEvidenceIds: [],
    estimatedValueAmount: null, estimatedValueCurrency: null,
    supportedClaims: [{ claim, evidenceIds: [id] }],
    rubric: {
      targetRelevance: { points: 20, evidenceIds: [id] }, companyAlignment: { points: 20, evidenceIds: [id] },
      evidenceOfNeed: { points: 20, evidenceIds: [id] }, timingStrength: { points: 0, evidenceIds: [] },
      riskPenalty: { points: 0, evidenceIds: [] },
    },
  };
}
function fixture() {
  const intelligence = new Map<string, any>();
  const evidence = new Map<string, any[]>();
  const events: any[] = [];
  let calls = 0;
  let hold: Promise<void> | null = null;
  const delegate = {
    findUnique: async ({ where }: any) => intelligence.get(`${where.userId_companyId.userId}:${where.userId_companyId.companyId}`) || null,
    create: async ({ data }: any) => {
      const key = `${data.userId}:${data.companyId}`;
      const row = { id: `intel-${key}`, createdAt: date, updatedAt: new Date(), ...data };
      intelligence.set(key, row); return row;
    },
    updateMany: async ({ where, data }: any) => {
      const key = `${where.userId}:${where.companyId}`;
      const row = intelligence.get(key);
      if (!row || row.id !== where.id || where.status && row.status !== where.status ||
        where.updatedAt && row.updatedAt.getTime() !== where.updatedAt.getTime() ||
        where.OR && !where.OR.some((condition: any) => condition.status?.not && row.status !== condition.status.not || condition.updatedAt?.lt && row.updatedAt < condition.updatedAt.lt)) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date() }); return { count: 1 };
    },
  };
  const evidenceDelegate = {
    deleteMany: async ({ where }: any) => { evidence.delete(`${where.userId}:${where.companyId}`); return { count: 1 }; },
    createMany: async ({ data }: any) => { evidence.set(`${data[0].userId}:${data[0].companyId}`, data); return { count: data.length }; },
    findMany: async ({ where }: any) => evidence.get(`${where.userId}:${where.companyId}`) || [],
  };
  const db = { companyIntelligence: delegate, companyEvidence: evidenceDelegate,
    $transaction: async (work: any) => work({ companyIntelligence: delegate, companyEvidence: evidenceDelegate }),
  } as unknown as PrismaClient;
  const provider: ResearchProvider = { async analyze(request, observer) {
    calls++;
    assert.ok(request.evidence.every(item => item.evidenceId.startsWith('company:')));
    assert.ok(!JSON.stringify(request).includes('VP Sales') || request.systemInstruction.includes('targetIndustries'));
    observer?.onRequestStart();
    if (hold) await hold;
    observer?.onResponse({ inputTokens: 100, outputTokens: 30, totalTokens: 130 });
    return output(request.evidence.find(item => item.evidenceId.endsWith(':industry'))!.evidenceId);
  } };
  const recordUsage = async (event: any) => { events.push(event); return {} as never; };
  const run = (c = company(), p = profile(), refreshCompany = false) => getOrResearchCompany({
    db, company: c, profile: p, provider, recordUsage, refreshCompany, validate: validateResearchOutput,
  });
  return { run, events, evidence, intelligence, calls: () => calls, hold: (value: Promise<void> | null) => { hold = value; } };
}

test('first company analysis is cached; same-company reuse emits no extra provider event', async () => {
  const f = fixture();
  const first = await f.run();
  assert.equal(first?.intelligence.status, 'READY');
  assert.equal(first?.reused, false);
  assert.equal(f.calls(), 1);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].operation, 'SCOUT_COMPANY_ANALYSIS');
  assert.equal(f.events[0].companyKey, 'acme.example');
  const second = await f.run();
  assert.equal(second?.reused, true);
  assert.equal(f.calls(), 1);
  assert.equal(f.events.length, 1);
  assert.ok([...f.evidence.values()].flat().every(row => !JSON.stringify(row).includes('VP Sales')));
});

test('material company or ICP changes invalidate; person-only changes do not', async () => {
  const f = fixture();
  const c = company(); const p = profile();
  await f.run(c, p);
  assert.notEqual(companyInputFingerprint({ ...c, industry: 'Other' }), companyInputFingerprint(c));
  assert.notEqual(icpInputFingerprint({ ...p, targetIndustries: ['Other'] }), icpInputFingerprint(p));
  await f.run({ ...c, name: 'Acme', updatedAt: new Date('2026-10-01') }, p);
  assert.equal(f.calls(), 1);
  await f.run({ ...c, companySizeMax: 300 }, p);
  assert.equal(f.calls(), 2);
  await f.run({ ...c, companySizeMax: 300 }, { ...p, targetIndustries: ['Other'] });
  assert.equal(f.calls(), 3);
  await f.run({ ...c, companySizeMax: 300 }, { ...p, targetIndustries: ['Other'] }, true);
  assert.equal(f.calls(), 4);
});

test('concurrent requests share one database lease and one paid company call', async () => {
  const f = fixture();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  f.hold(waiting);
  const first = f.run();
  await new Promise(resolve => setTimeout(resolve, 10));
  const second = f.run();
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a?.intelligence.status, 'READY');
  assert.equal(b?.intelligence.status, 'READY');
  assert.equal(f.calls(), 1);
  assert.equal(f.events.length, 1);
});

test('company sources contain only shared factual fields', () => {
  const sources = companySources(company());
  assert.ok(sources.some(row => row.content.includes('B2B SaaS')));
  assert.ok(sources.every(row => !row.content.includes('VP Sales') && !row.content.includes('Sarah')));
});

test('cross-tenant ICP cannot access another tenant company cache', async () => {
  const f = fixture();
  await assert.rejects(f.run(company('tenant-a'), profile('tenant-b')), /same tenant/);
  assert.equal(f.calls(), 0);
});
