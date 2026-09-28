import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma, type PrismaClient, type Prospect } from '@prisma/client';
import { buildFallbackIdentityKey, normalizeCompanyName, normalizeEmail, normalizeLinkedInUrl, normalizePersonName, normalizeWebsiteDomain } from '../src/lib/prospects/normalization';
import { identityTransaction, resolveOrCreateProspect } from '../src/lib/prospects/identity';
import { inboundProspectInTransaction, saveGeneratedLead } from '../src/lib/prospects/persistence';
import { installMemoryFixture } from './memory-fixture';

// Isolated repository double: no environment or database access. DB races require a separate PostgreSQL run.
function fixture() {
  const rows: Prospect[] = [];
  const companies: Record<string, any>[] = [];
  const leads: Record<string, any>[] = [];
  const tx = {
    prospect: {
      findUnique: async ({ where }: any) => {
        const key = Object.values(where)[0] as Record<string, unknown>;
        return rows.find(p => Object.entries(key).every(([k, v]) => p[k as keyof Prospect] === v)) || null;
      },
      findMany: async ({ where, take }: any) => rows.filter(p => p.userId === where.userId && p.fallbackIdentityKey === where.fallbackIdentityKey).slice(0, take),
      create: async ({ data }: any) => {
        const row = { id: `p${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.push(row); return row;
      },
      update: async ({ where, data }: any) => {
        const row = rows.find(p => p.id === where.userId_id.id && p.userId === where.userId_id.userId)!;
        Object.assign(row, data); return row;
      },
    },
    company: {
      findUnique: async ({ where }: any) => companies.find(c => where.userId_id
        ? c.userId === where.userId_id.userId && c.id === where.userId_id.id
        : c.userId === where.userId_normalizedDomain?.userId && c.normalizedDomain === where.userId_normalizedDomain?.normalizedDomain) || null,
      findMany: async ({ where, take }: any) => companies.filter(c => c.userId === where.userId && c.normalizedName === where.normalizedName).slice(0, take),
      create: async ({ data }: any) => { const row = { id: `c${companies.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data }; companies.push(row); return row; },
      update: async ({ where, data }: any) => Object.assign(companies.find(c => c.id === where.userId_id.id)!, data),
    },
    generatedLead: {
      findFirst: async ({ where }: any) => leads.find(l => l.id === where.id && l.userId === where.userId) || null,
      update: async ({ where, data }: any) => Object.assign(leads.find(l => l.id === where.id && l.userId === where.userId)!, data),
      create: async ({ data }: any) => { const lead = { id: `l${leads.length + 1}`, ...data }; leads.push(lead); return lead; },
    },
  };
  installMemoryFixture(tx);
  const db = { $transaction: async (fn: any, options: any) => {
    assert.equal(options.isolationLevel, 'Serializable');
    const backup = structuredClone(rows);
    try { return await fn(tx); } catch (e) { rows.splice(0, rows.length, ...backup); throw e; }
  } } as unknown as PrismaClient;
  return { rows, companies, leads, tx: tx as unknown as Prisma.TransactionClient, db, resolve: (data: any) => resolveOrCreateProspect(db, { userId: 'u1', ...data }) };
}
const person = { firstName: 'John', lastName: 'Smith', companyName: 'Acme' };

test('normalization preserves aliases, path case, name distinctions and rejects placeholders', () => {
  assert.equal(normalizeEmail(' A.B+tag@Example.com '), 'a.b+tag@example.com');
  assert.equal(normalizeEmail('not an email'), null);
  assert.equal(normalizeLinkedInUrl(' HTTP://WWW.LINKEDIN.COM/in/Jane/?trk=x#bio '), 'https://linkedin.com/in/Jane');
  assert.equal(normalizeLinkedInUrl('https://evil.com/in/Jane'), null);
  assert.equal(normalizeLinkedInUrl('missing-url-123'), null);
  assert.equal(normalizeLinkedInUrl('https://linkedin.com/company/acme'), null);
  assert.equal(normalizePersonName('  Anne   O’Neil '), "anne o'neil");
  assert.notEqual(normalizePersonName('Anne-Marie'), normalizePersonName('Anne Marie'));
  assert.equal(normalizeCompanyName(' ACME   Inc. '), 'acme inc.');
  assert.equal(normalizeWebsiteDomain('http://WWW.Acme.com/a?b=c'), 'acme.com');
  assert.equal(buildFallbackIdentityKey({ firstName: 'Unknown', lastName: 'Person', companyName: 'Acme' }), null);
  assert.equal(buildFallbackIdentityKey({ firstName: 'John', companyName: 'Acme' }), null);
});
test('A: same tenant and case-insensitive email resolve once', async () => {
  const f = fixture(); const a = await f.resolve({ email: ' Alice@Acme.com ' });
  const b = await f.resolve({ email: 'alice@acme.com' });
  assert.equal(b.prospectId, a.prospectId); assert.equal(f.rows.length, 1); assert.equal(b.status, 'resolved');
});
test('B/C: LinkedIn tracking variants resolve and enrich missing email', async () => {
  const f = fixture(); const a = await f.resolve({ linkedInUrl: 'http://www.linkedin.com/in/sarah/?x=1' });
  const b = await f.resolve({ linkedInUrl: 'https://linkedin.com/in/sarah#bio', email: 'Sarah@Acme.com' });
  assert.equal(b.prospectId, a.prospectId); assert.equal(f.rows[0].normalizedEmail, 'sarah@acme.com');
});
test('D: conservative fallback and later email enrichment', async () => {
  const f = fixture(); const a = await f.resolve(person);
  const b = await f.resolve({ ...person, firstName: ' JOHN ', companyName: 'ACME', email: 'john@acme.com' });
  assert.equal(a.prospectId, b.prospectId); assert.equal(f.rows.length, 1);
});
test('D: website representation differences have identical fallback', () => {
  assert.equal(buildFallbackIdentityKey({ ...person, websiteUrl: 'https://www.acme.com/a' }), buildFallbackIdentityKey({ ...person, websiteUrl: 'acme.com' }));
});
test('E: distinct emails with same fallback remain distinct; weak third input is ambiguous', async () => {
  const f = fixture(); const a = await f.resolve({ ...person, email: 'john1@acme.com' });
  const b = await f.resolve({ ...person, email: 'john2@acme.com' });
  assert.notEqual(a.prospectId, b.prospectId); assert.equal(f.rows.length, 2);
  const c = await f.resolve(person); assert.equal(c.status, 'conflict'); assert.equal(c.prospectId, null);
  assert.equal((await f.resolve({ ...person, email: 'john1@acme.com' })).prospectId, a.prospectId);
});
test('F: email identity is tenant scoped', async () => {
  const f = fixture(); const a = await f.resolve({ email: 'john@acme.com' });
  const b = await f.resolve({ userId: 'u2', email: 'john@acme.com' });
  assert.notEqual(a.prospectId, b.prospectId);
});
test('company identity is tenant scoped, domain-first, and does not merge conflicting domains', async () => {
  const f = fixture();
  await f.resolve({ userId: 'u1', email: 'sarah@acme.com', companyName: 'Acme', websiteUrl: 'https://www.acme.com', industry: 'SaaS' });
  await f.resolve({ userId: 'u1', email: 'john@acme.com', companyName: 'ACME', websiteUrl: 'http://acme.com/about' });
  assert.equal(f.rows[0].companyId, f.rows[1].companyId);
  assert.equal(f.companies.length, 1);
  await f.resolve({ userId: 'u2', email: 'jane@acme.com', companyName: 'Acme', websiteUrl: 'acme.com' });
  assert.notEqual(f.rows[0].companyId, f.rows[2].companyId);
  await f.resolve({ userId: 'u1', email: 'other@acme.com', companyName: 'Acme', websiteUrl: 'different.example' });
  assert.notEqual(f.rows[0].companyId, f.rows[3].companyId);
  assert.equal(f.companies[0].industry, 'SaaS');
  await f.resolve({ userId: 'u1', email: 'alex@acme.com', companyName: 'Acme', websiteUrl: 'acme.com', industry: 'Manufacturing' });
  assert.equal(f.companies[0].industry, 'SaaS');
});
test('G: email and LinkedIn resolving to different records changes neither record', async () => {
  const f = fixture(); await f.resolve({ email: 'john@acme.com' });
  await f.resolve({ linkedInUrl: 'linkedin.com/in/john' }); const before = structuredClone(f.rows);
  const result = await f.resolve({ email: 'john@acme.com', linkedInUrl: 'linkedin.com/in/john' });
  assert.equal(result.status, 'conflict'); assert.deepEqual(f.rows, before);
});
test('nonempty strong identifiers are never overwritten', async () => {
  const f = fixture(); await f.resolve({ email: 'old@acme.com', linkedInUrl: 'linkedin.com/in/john' });
  const result = await f.resolve({ email: 'new@acme.com', linkedInUrl: 'linkedin.com/in/john' });
  assert.equal(result.status, 'conflict'); assert.equal(f.rows[0].normalizedEmail, 'old@acme.com');
});
test('fallback enrichment uses retained fields, not conflicting incoming names', async () => {
  const f = fixture(); await f.resolve({ firstName: 'John', lastName: 'Smith', email: 'john@acme.com' });
  await f.resolve({ firstName: 'Mike', lastName: 'Jones', companyName: 'Acme', email: 'john@acme.com' });
  assert.equal(f.rows[0].firstName, 'John');
  assert.equal(f.rows[0].fallbackIdentityKey, buildFallbackIdentityKey(person));
});
test('H: inbound reuses linked lead Prospect, without resolving sender as another Prospect', async () => {
  const f = fixture(); const p = await f.resolve({ email: 'john@acme.com' });
  f.leads.push({ id: 'l1', userId: 'u1', prospectId: p.prospectId });
  const result = await inboundProspectInTransaction(f.tx, { userId: 'u1', generatedLeadId: 'l1', prospectEmail: 'other@acme.com' } as any);
  assert.equal(result.prospectId, p.prospectId); assert.equal(f.rows.length, 1);
  await assert.rejects(inboundProspectInTransaction(f.tx, { userId: 'u2', generatedLeadId: 'l1' } as any), /not owned/);
});
test('legacy linked lead is resolved and attached idempotently', async () => {
  const f = fixture(); f.leads.push({ id: 'l1', userId: 'u1', ...person, email: 'john@acme.com', prospectId: null });
  const data = { userId: 'u1', generatedLeadId: 'l1' } as any;
  const a = await inboundProspectInTransaction(f.tx, data); const b = await inboundProspectInTransaction(f.tx, data);
  assert.equal(a.prospectId, b.prospectId); assert.equal(f.leads[0].prospectId, a.prospectId); assert.equal(f.rows.length, 1);
});
test('missing evidence does not create an empty identity', async () => {
  const f = fixture(); assert.equal((await f.resolve({ firstName: 'John' })).status, 'insufficient_identity'); assert.equal(f.rows.length, 0);
});
test('inbound email can identify a linked legacy lead with insufficient evidence', async () => {
  const f = fixture(); f.leads.push({ id: 'l1', userId: 'u1', firstName: 'Unknown', lastName: '', companyName: 'Unknown Company', prospectId: null });
  const result = await inboundProspectInTransaction(f.tx, { userId: 'u1', generatedLeadId: 'l1', prospectEmail: 'jane@acme.com' } as any);
  assert.equal(result.status, 'created'); assert.equal(f.leads[0].prospectId, result.prospectId);
  assert.equal(f.rows[0].normalizedEmail, 'jane@acme.com');
});
test('regeneration does not reassign an established lead', async () => {
  const f = fixture(); const a = await f.resolve({ email: 'john@acme.com' });
  f.leads.push({ id: 'l1', userId: 'u1', prospectId: a.prospectId });
  await assert.rejects(saveGeneratedLead(f.db, { userId: 'u1', ...person, email: 'someone@acme.com', emailDraft: '', linkedInDraft: '' }, 'l1'), /identity conflict/);
  assert.equal(f.leads[0].prospectId, a.prospectId); assert.equal(f.rows.length, 1);
});
test('retry serialization and unique conflicts; propagate unexpected DB errors', async () => {
  for (const code of ['P2002', 'P2034']) {
    let calls = 0;
    const db = { $transaction: async () => { if (++calls < 3) throw new Prisma.PrismaClientKnownRequestError('retry', { code, clientVersion: '5.22.0' }); return 'ok'; } } as unknown as PrismaClient;
    assert.equal(await identityTransaction(db, async () => 'unused'), 'ok'); assert.equal(calls, 3);
  }
  const failure = new Error('database unavailable'); let calls = 0;
  const db = { $transaction: async () => { calls++; throw failure; } } as unknown as PrismaClient;
  await assert.rejects(identityTransaction(db, async () => null), failure); assert.equal(calls, 1);
});
