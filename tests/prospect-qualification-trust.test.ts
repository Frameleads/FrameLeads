import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ICPQualificationPolicy, LeadSourceType, QualificationOverride, QualificationReasonCode,
  type ICPProfile, type PrismaClient,
} from '@prisma/client';
import { evaluateICP, qualifyProspect, setQualificationOverride, validateICPProfile } from '../src/lib/prospects/qualification';
import { qualificationLabel } from '../src/lib/scout-view';
import { researchProspectICP } from '../src/lib/prospects/research';

const profile = (fields: Partial<ICPProfile> = {}): ICPProfile => ({
  id: 'icp', userId: 'tenant-a', name: 'Default', isActive: true, qualificationPolicy: ICPQualificationPolicy.CONSERVATIVE,
  targetTitles: [], targetSeniorities: [], targetIndustries: [], targetGeographies: [],
  excludedTitles: [], excludedIndustries: [], excludedDomains: [],
  companySizeMin: null, companySizeMax: null, requiredKeywords: [], excludedKeywords: [],
  createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-02'), ...fields,
});
const known = { websiteUrl: 'https://acme.example', incidentDetails: [], jobTitle: 'Director of Revenue Operations', industry: 'Manufacturing', country: 'Germany', companySizeMin: 5000, companySizeMax: null };

test('A/B/K: explicit exclusions reject in every policy, including curated lists', () => {
  for (const qualificationPolicy of Object.values(ICPQualificationPolicy)) {
    const domain = evaluateICP(profile({ qualificationPolicy, excludedDomains: ['acme.example'] }), { ...known, sourceType: LeadSourceType.USER_CURATED });
    const title = evaluateICP(profile({ qualificationPolicy, excludedTitles: [known.jobTitle] }), { ...known, sourceType: LeadSourceType.USER_CURATED });
    assert.equal(domain.status, 'REJECTED'); assert.equal(domain.reasonCode, QualificationReasonCode.EXCLUDED);
    assert.equal(title.status, 'REJECTED'); assert.equal(title.reasonCode, QualificationReasonCode.EXCLUDED);
  }
});

test('C/D/J/L: conservative and unknown-source positive mismatches require review', () => {
  const title = evaluateICP(profile({ targetTitles: ['VP Sales', 'CRO'] }), { ...known, sourceType: LeadSourceType.USER_CURATED });
  const size = evaluateICP(profile({ companySizeMin: 50, companySizeMax: 500 }), known);
  assert.equal(title.status, 'NEEDS_REVIEW'); assert.equal(title.reasonCode, QualificationReasonCode.TARGET_MISMATCH);
  assert.match(title.qualificationReason, /Director of Revenue Operations/);
  assert.match(title.qualificationReason, /VP Sales/);
  assert.equal(size.status, 'NEEDS_REVIEW'); assert.equal(size.reasonCode, QualificationReasonCode.TARGET_MISMATCH);
  assert.equal(qualificationLabel(title.status, title.reasonCode, 'AUTO'), 'Needs Review — ICP mismatch');
});

test('E/F: missing data remains review in every policy; known full match qualifies', () => {
  for (const qualificationPolicy of Object.values(ICPQualificationPolicy)) {
    const missing = evaluateICP(profile({ qualificationPolicy, targetTitles: ['VP Sales'] }), { websiteUrl: null, incidentDetails: [] });
    assert.equal(missing.status, 'NEEDS_REVIEW'); assert.equal(missing.reasonCode, QualificationReasonCode.MISSING_DATA);
    const matched = evaluateICP(profile({ qualificationPolicy, targetTitles: ['VP Sales'] }), { ...known, jobTitle: 'Vice President of Sales' });
    assert.equal(matched.status, 'QUALIFIED');
  }
});

test('G/H/I: balanced needs multiple strong mismatches; strict rejects known mismatch', () => {
  const balanced = profile({ qualificationPolicy: ICPQualificationPolicy.BALANCED, targetTitles: ['VP Sales'], targetIndustries: ['B2B SaaS'], targetGeographies: ['United States'], companySizeMin: 50, companySizeMax: 500 });
  const adjacent = evaluateICP(balanced, { ...known, industry: 'B2B SaaS', country: 'United States', companySizeMin: 100, companySizeMax: 200 });
  assert.equal(adjacent.status, 'NEEDS_REVIEW');
  const multiple = evaluateICP(balanced, { ...known, sourceType: LeadSourceType.BROAD_POOL });
  assert.equal(multiple.status, 'REJECTED'); assert.equal(multiple.reasonCode, QualificationReasonCode.TARGET_MISMATCH);
  const curated = evaluateICP(balanced, { ...known, sourceType: LeadSourceType.USER_CURATED, country: 'United States' });
  assert.equal(curated.status, 'NEEDS_REVIEW'); // Two strong mismatches, curated threshold is three.
  const strict = evaluateICP(profile({ qualificationPolicy: ICPQualificationPolicy.STRICT, targetTitles: ['VP Sales'] }), known);
  assert.equal(strict.status, 'REJECTED');
});

function persistenceFixture() {
  const currentProfile = profile({ targetTitles: ['VP Sales'] });
  let record: any = null;
  const db = {
    prospect: { findUnique: async ({ where }: any) => where.userId_id.userId === 'tenant-a' ? { id: 'p1', updatedAt: new Date('2026-09-01'), websiteUrl: null, jobTitle: 'VP Sales', industry: null, country: null, location: null, companySizeMin: null, companySizeMax: null } : null },
    iCPProfile: { findUnique: async ({ where }: any) => where.userId === 'tenant-a' ? currentProfile : null, upsert: async () => currentProfile },
    generatedLead: { findMany: async () => [] },
    prospectQualification: {
      findUnique: async () => record,
      create: async ({ data }: any) => { record = { id: 'q1', override: 'AUTO', ...data }; return record; },
      updateMany: async ({ where, data }: any) => { if (!record || where.override && record.override !== where.override) return { count: 0 }; Object.assign(record, data); return { count: 1 }; },
      upsert: async ({ create, update }: any) => { record = record ? { ...record, ...update } : { id: 'q1', ...create }; return record; },
    },
  } as unknown as PrismaClient;
  return { db, current: () => record, set: (value: any) => { record = value; } };
}

test('M/N/R: tenant-scoped human overrides survive reruns and control the gate', async () => {
  const f = persistenceFixture();
  await assert.rejects(setQualificationOverride({ userId: 'tenant-b', prospectId: 'p1', override: QualificationOverride.USER_QUALIFIED }, f.db), /not found/);
  const kept = await setQualificationOverride({ userId: 'tenant-a', prospectId: 'p1', override: QualificationOverride.USER_QUALIFIED }, f.db);
  assert.equal(kept.status, 'QUALIFIED'); assert.ok(kept.overriddenAt instanceof Date);
  await qualifyProspect({ userId: 'tenant-a', prospectId: 'p1' }, f.db);
  assert.equal(f.current().override, 'USER_QUALIFIED');
  const gateDb = { ...f.db, prospectIntelligence: { findUnique: async () => null } } as unknown as PrismaClient;
  await assert.rejects(researchProspectICP({ userId: 'tenant-a', prospectId: 'p1' }, { db: gateDb }), /create/); // Reaches the full research lease; this test double stops there.
  const excluded = await setQualificationOverride({ userId: 'tenant-a', prospectId: 'p1', override: QualificationOverride.USER_EXCLUDED }, f.db);
  assert.equal(excluded.status, 'REJECTED');
  await qualifyProspect({ userId: 'tenant-a', prospectId: 'p1' }, f.db);
  assert.equal(f.current().override, 'USER_EXCLUDED');
  let calls = 0;
  const result = await researchProspectICP({ userId: 'tenant-a', prospectId: 'p1' }, { db: gateDb, provider: { analyze: async () => { calls++; throw new Error('No Gemini expected'); } } });
  assert.equal(result.status, 'NOT_ELIGIBLE'); assert.equal(calls, 0);
});

test('O/P/Q: excluded and review cases consume zero Gemini; qualified research path remains available', async () => {
  const db = { prospect: { findUnique: async () => ({ id: 'p1', userId: 'tenant-a' }) }, prospectIntelligence: { findUnique: async () => null } } as unknown as PrismaClient;
  let calls = 0;
  const provider = { analyze: async () => { calls++; throw new Error('Unexpected Gemini call'); } };
  for (const status of ['REJECTED', 'NEEDS_REVIEW'] as const) {
    const result = await researchProspectICP({ userId: 'tenant-a', prospectId: 'p1' }, { db, provider, qualify: async () => ({ status, qualificationReason: 'Known rule' }) as never });
    assert.equal(result.status, status === 'REJECTED' ? 'NOT_ELIGIBLE' : 'QUALIFICATION_REQUIRED');
  }
  assert.equal(calls, 0);
  await assert.rejects(researchProspectICP({ userId: 'tenant-a', prospectId: 'p1' }, { db, provider, qualify: async () => ({ status: 'QUALIFIED' }) as never }), /create/);
});

test('policy is validated and legacy automatic status is labeled for reevaluation', () => {
  assert.equal(validateICPProfile({ qualificationPolicy: ICPQualificationPolicy.CONSERVATIVE }).qualificationPolicy, 'CONSERVATIVE');
  assert.throws(() => validateICPProfile({ qualificationPolicy: 'AGGRESSIVE' as never }), /Invalid qualification policy/);
  assert.equal(qualificationLabel('REJECTED', 'NONE', 'AUTO', 0), 'Needs Review — Requalification required');
});
