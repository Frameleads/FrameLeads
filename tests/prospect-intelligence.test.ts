import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProspectEvidenceType, ProspectResearchStatus, ProspectValueBand, type PrismaClient } from '@prisma/client';
import {
  addProspectEvidence, getProspectIntelligence, replaceProspectEvidence,
  upsertProspectIntelligence, validateEvidence, validateIntelligencePatch,
} from '../src/lib/prospects/intelligence';

const alice = { userId: 'user-a', prospectId: 'prospect-a' };
const bob = { userId: 'user-b', prospectId: 'prospect-b' };
const website = (claim = 'ACME is hiring outbound sales roles.') => ({
  evidenceType: ProspectEvidenceType.CAREERS,
  sourceTitle: 'ACME Careers',
  sourceUrl: 'https://acme.example/careers',
  claim,
});

function fixture() {
  const prospects = [{ id: alice.prospectId, userId: alice.userId }, { id: bob.prospectId, userId: bob.userId }];
  let intelligence: Record<string, any>[] = [];
  let evidence: Record<string, any>[] = [];
  let nextId = 1;
  const findIntelligence = (where: any) => intelligence.find(row => row.userId === where.userId && row.prospectId === where.prospectId) || null;
  const matchesEvidence = (row: any, where: any) => row.userId === where.userId && row.prospectIntelligenceId === where.prospectIntelligenceId;
  const tx = {
    prospect: { findUnique: async ({ where }: any) => prospects.find(row => row.userId === where.userId_id.userId && row.id === where.userId_id.id) || null },
    prospectIntelligence: {
      findUnique: async ({ where, include }: any) => {
        const row = findIntelligence(where.userId_prospectId);
        return row && include ? { ...row, evidence: evidence.filter(item => matchesEvidence(item, { userId: row.userId, prospectIntelligenceId: row.id })) } : row;
      },
      upsert: async ({ where, create, update }: any) => {
        let row = findIntelligence(where.userId_prospectId);
        if (!row) {
          row = { id: `intelligence-${nextId++}`, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
            fitScore: null, confidenceScore: null, researchStatus: ProspectResearchStatus.NOT_RESEARCHED, ...create };
          intelligence.push(row as Record<string, any>);
        } else Object.assign(row, update, { updatedAt: new Date('2026-02-01') });
        return row;
      },
    },
    prospectEvidence: {
      create: async ({ data }: any) => { const row = { id: `evidence-${nextId++}`, ...data }; evidence.push(row); return row; },
      createMany: async ({ data }: any) => { for (const item of data) evidence.push({ id: `evidence-${nextId++}`, ...item }); return { count: data.length }; },
      deleteMany: async ({ where }: any) => { const before = evidence.length; evidence = evidence.filter(row => !matchesEvidence(row, where)); return { count: before - evidence.length }; },
      findMany: async ({ where }: any) => evidence.filter(row => matchesEvidence(row, where)),
    },
  };
  const db = {
    ...tx,
    $transaction: async (work: any) => {
      const oldIntelligence = structuredClone(intelligence), oldEvidence = structuredClone(evidence), oldNextId = nextId;
      try { return await work(tx); }
      catch (error) { intelligence = oldIntelligence; evidence = oldEvidence; nextId = oldNextId; throw error; }
    },
  } as unknown as PrismaClient;
  return { db, rows: () => intelligence, evidence: () => evidence };
}

test('A/B: one current intelligence row per prospect; updating preserves id and createdAt', async () => {
  const f = fixture();
  const first = await upsertProspectIntelligence(f.db, alice, { fitScore: 0 });
  const second = await upsertProspectIntelligence(f.db, alice, { fitScore: 100 });
  assert.equal(first.id, second.id);
  assert.equal(f.rows().length, 1);
  assert.equal(second.createdAt.getTime(), new Date('2026-01-01').getTime());
  assert.equal((await getProspectIntelligence(f.db, alice))?.fitScore, 100);
  const migration = readFileSync(join(__dirname, '../prisma/migrations/20260927100000_add_prospect_intelligence/migration.sql'), 'utf8');
  assert.match(migration, /CREATE UNIQUE INDEX "ProspectIntelligence_prospectId_key"/);
});

test('C/D/E: scores accept 0 and 100, reject invalid, and preserve null as unassessed', () => {
  for (const field of ['fitScore', 'confidenceScore'] as const) {
    assert.equal(validateIntelligencePatch({ [field]: 0 })[field], 0);
    assert.equal(validateIntelligencePatch({ [field]: 100 })[field], 100);
    assert.equal(validateIntelligencePatch({ [field]: null })[field], null);
    for (const value of [-1, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => validateIntelligencePatch({ [field]: value }), RangeError);
    }
  }
});

test('F: qualitative value needs no exact amount; amount and currency are validated when supplied', async () => {
  const f = fixture();
  const saved = await upsertProspectIntelligence(f.db, alice, { potentialValueBand: ProspectValueBand.HIGH });
  assert.equal(saved.potentialValueBand, ProspectValueBand.HIGH);
  assert.equal(saved.estimatedValueAmount, undefined);
  assert.equal(validateIntelligencePatch({ estimatedValueCurrency: ' usd ' }).estimatedValueCurrency, 'USD');
  for (const value of ['-1', '1.234', 'Infinity']) assert.throws(() => validateIntelligencePatch({ estimatedValueAmount: value }), RangeError);
  assert.throws(() => validateIntelligencePatch({ estimatedValueCurrency: 'US' }), TypeError);
});

test('G/H: valid evidence stores claim and source separately; blank claim and invalid URL fail', async () => {
  const f = fixture(); await upsertProspectIntelligence(f.db, alice, {});
  const saved = await addProspectEvidence(f.db, alice, website());
  assert.equal(saved.claim, 'ACME is hiring outbound sales roles.');
  assert.equal(saved.sourceTitle, 'ACME Careers');
  await assert.rejects(addProspectEvidence(f.db, alice, website('  ')), /claim cannot be blank/);
  assert.throws(() => validateEvidence({ ...website(), sourceUrl: 'file:///etc/passwd' }), /HTTP\(S\)/);
  assert.equal(f.evidence().length, 1);
});

test('I/J: ownership is checked for intelligence, evidence and reads', async () => {
  const f = fixture();
  await assert.rejects(upsertProspectIntelligence(f.db, { userId: bob.userId, prospectId: alice.prospectId }, { fitScore: 50 }), /not found/);
  await assert.rejects(getProspectIntelligence(f.db, { userId: bob.userId, prospectId: alice.prospectId }), /not found/);
  await upsertProspectIntelligence(f.db, alice, { fitScore: 50 });
  await assert.rejects(addProspectEvidence(f.db, { userId: bob.userId, prospectId: alice.prospectId }, website()), /not found/);
  await assert.rejects(replaceProspectEvidence(f.db, { userId: bob.userId, prospectId: alice.prospectId }, [website()]), /not found/);
  assert.equal(f.evidence().length, 0);
  const migration = readFileSync(join(__dirname, '../prisma/migrations/20260927100000_add_prospect_intelligence/migration.sql'), 'utf8');
  assert.match(migration, /FOREIGN KEY \("userId", "prospectId"\) REFERENCES "Prospect"\("userId", "id"\)/);
  assert.match(migration, /FOREIGN KEY \("userId", "prospectIntelligenceId"\) REFERENCES "ProspectIntelligence"\("userId", "id"\)/);
});

test('K/L: add retains evidence, replace changes only the specified intelligence collection', async () => {
  const f = fixture(); await upsertProspectIntelligence(f.db, alice, {}); await upsertProspectIntelligence(f.db, bob, {});
  await addProspectEvidence(f.db, alice, website('First claim'));
  await addProspectEvidence(f.db, alice, website('Second claim'));
  await addProspectEvidence(f.db, bob, website('Bob claim'));
  assert.equal((await getProspectIntelligence(f.db, alice))?.evidence.length, 2);
  await upsertProspectIntelligence(f.db, alice, { whyFit: '  Good fit  ' });
  assert.equal((await getProspectIntelligence(f.db, alice))?.evidence.length, 2);
  const replacement = await replaceProspectEvidence(f.db, alice, [website('Replacement claim')]);
  assert.deepEqual(replacement.map(item => item.claim), ['Replacement claim']);
  assert.deepEqual(f.evidence().filter(item => item.userId === bob.userId).map(item => item.claim), ['Bob claim']);
  assert.equal((await getProspectIntelligence(f.db, alice))?.whyFit, 'Good fit');
});

test('research timestamp changes only on explicit committed result; collections are trimmed and deduplicated', async () => {
  const f = fixture();
  const first = await upsertProspectIntelligence(f.db, alice, { triggers: [' Hiring ', '', 'hiring', 'Expansion'], risks: ['  unknown timing  ', 'UNKNOWN TIMING'] });
  assert.deepEqual(first.triggers, ['Hiring', 'Expansion']); assert.deepEqual(first.risks, ['unknown timing']);
  assert.equal(first.researchedAt, undefined);
  const second = await upsertProspectIntelligence(f.db, alice, { researchStatus: ProspectResearchStatus.RESEARCHING });
  assert.equal(second.researchedAt, undefined);
  await assert.rejects(upsertProspectIntelligence(f.db, alice, { researchResultCommitted: true, researchStatus: ProspectResearchStatus.FAILED }), /requires READY/);
  const completed = await upsertProspectIntelligence(f.db, alice, { researchResultCommitted: true, researchStatus: ProspectResearchStatus.READY });
  assert.ok(completed.researchedAt instanceof Date);
  const timestamp = completed.researchedAt;
  const edited = await upsertProspectIntelligence(f.db, alice, { whyNow: '  New roles  ' });
  assert.equal(edited.researchedAt, timestamp);
});

test('database migration enforces range and cascade invariants', () => {
  const migration = readFileSync(join(__dirname, '../prisma/migrations/20260927100000_add_prospect_intelligence/migration.sql'), 'utf8');
  for (const check of ['fitScore_range', 'confidenceScore_range', 'estimatedValueAmount_nonnegative', 'claim_nonblank']) assert.ok(migration.includes(check));
  assert.equal((migration.match(/ON DELETE CASCADE/g) || []).length, 2);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});
