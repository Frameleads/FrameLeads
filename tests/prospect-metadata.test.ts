import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICPQualificationPolicy, type ICPProfile, type Prospect } from '@prisma/client';
import { extractProspectMetadata, normalizeCountry, parseCompanySize } from '../src/lib/prospects/metadata';
import { resolveProspectInTransaction } from '../src/lib/prospects/identity';
import { evaluateICP } from '../src/lib/prospects/qualification';

const rules = (input: Partial<ICPProfile>): ICPProfile => ({
  id: 'icp', userId: 'tenant', name: 'ICP', isActive: true, qualificationPolicy: ICPQualificationPolicy.CONSERVATIVE, targetTitles: [], targetSeniorities: [],
  targetIndustries: [], targetGeographies: [], excludedTitles: [], excludedIndustries: [], excludedDomains: [],
  companySizeMin: null, companySizeMax: null, requiredKeywords: [], excludedKeywords: [],
  createdAt: new Date(), updatedAt: new Date(), ...input,
});
const source = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

test('A/B/C/G: common CSV aliases preserve explicit title, industry and geography; absent data stays null', () => {
  const facts = extractProspectMetadata({ ' job_title ': ' VP Sales ', 'Company Industry': 'B2B SaaS', country_code: 'UAE', location: 'Dubai' });
  assert.deepEqual(facts, { jobTitle: 'VP Sales', industry: 'B2B SaaS', country: 'United Arab Emirates', location: 'Dubai', companySizeMin: null, companySizeMax: null });
  assert.equal(extractProspectMetadata({ company_name: 'Acme' }).jobTitle, null);
  assert.equal(extractProspectMetadata({ title: 'VP Sales', role: 'Marketing Manager' }).jobTitle, null);
  assert.match(source('src/app/dashboard/ingestion/IngestionClient.tsx'), /extractProspectMetadata\(row\)/);
  assert.match(source('src/app/api/generate/route.ts'), /extractProspectMetadata\(lead\)/);
  assert.match(source('src/app/api/generate/route.ts'), /extractProspectMetadata\(source\)/);
  assert.match(source('src/lib/prospects/persistence.ts'), /resolveProspectInTransaction\(tx, \{ \.\.\.data, \.\.\.metadata \}\)/);
});

test('D/E/F: company size parser accepts exact, range and open-ended forms, rejects malformed values', () => {
  assert.deepEqual(parseCompanySize('150'), { companySizeMin: 150, companySizeMax: 150 });
  assert.deepEqual(parseCompanySize('51-200'), { companySizeMin: 51, companySizeMax: 200 });
  assert.deepEqual(parseCompanySize('51 – 200'), { companySizeMin: 51, companySizeMax: 200 });
  assert.deepEqual(parseCompanySize('201 to 500'), { companySizeMin: 201, companySizeMax: 500 });
  assert.deepEqual(parseCompanySize('1,000+'), { companySizeMin: 1000, companySizeMax: null });
  assert.equal(parseCompanySize('enterprise'), null);
  assert.equal(parseCompanySize('500-50'), null);
  assert.deepEqual(extractProspectMetadata({ employees: '1,000+' }).companySizeMax, null);
  assert.deepEqual(extractProspectMetadata({ company_size: 'enterprise' }).companySizeMin, null);
  assert.equal(extractProspectMetadata({ employee_count: '51-200', employees: '201-500' }).companySizeMin, null);
  assert.equal(extractProspectMetadata({ employee_count: '51-200', employees: '51 – 200' }).companySizeMin, 51);
});

test('C: small country alias map supports deterministic comparison without geocoding', () => {
  assert.equal(normalizeCountry('US'), 'United States');
  assert.equal(normalizeCountry('United States'), 'United States');
  assert.equal(normalizeCountry('UAE'), 'United Arab Emirates');
  assert.equal(normalizeCountry('Dubai'), 'Dubai');
});

test('H: campaign targetGroup never becomes a factual title', () => {
  assert.equal(extractProspectMetadata({ targetGroup: 'VP Sales' }).jobTitle, null);
  assert.equal(evaluateICP(rules({ targetTitles: ['VP Sales'] }), { websiteUrl: null, incidentDetails: [], jobTitle: null }).status, 'NEEDS_REVIEW');
});

test('I/J: resolver fills null metadata but preserves conflicting non-null facts', async () => {
  const rows: Prospect[] = [];
  const tx = { prospect: {
    findUnique: async ({ where }: any) => rows.find(row => row.userId === where.userId_normalizedEmail?.userId && row.normalizedEmail === where.userId_normalizedEmail?.normalizedEmail) || null,
    findMany: async () => [],
    create: async ({ data }: any) => { const row = { id: 'p1', createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ data }: any) => Object.assign(rows[0], data),
  }, company: {
    findUnique: async () => null, findMany: async () => [],
    create: async ({ data }: any) => ({ id: 'c1', createdAt: new Date(), updatedAt: new Date(), ...data }),
    update: async ({ data }: any) => data,
  } };
  const resolve = (metadata: ReturnType<typeof extractProspectMetadata>) => resolveProspectInTransaction(tx as never, { userId: 'tenant', email: 'jane@acme.com', ...metadata });
  await resolve(extractProspectMetadata({}));
  assert.equal(rows[0].jobTitle, null);
  await resolve(extractProspectMetadata({ title: 'VP Sales', industry: 'SaaS', company_size: '51-200' }));
  assert.equal(rows[0].jobTitle, 'VP Sales');
  assert.equal(rows[0].companySizeMin, 51);
  await resolve(extractProspectMetadata({ title: 'Marketing Manager', company_size: '201-500' }));
  assert.equal(rows[0].jobTitle, 'VP Sales');
  assert.equal(rows[0].companySizeMin, 51);
  assert.equal(rows[0].companySizeMax, 200);
});

test('K/L/M/N/O/P: first-class facts drive zero-cost qualification and ambiguous ranges remain review', () => {
  const base = { websiteUrl: null, incidentDetails: [], jobTitle: 'VP Sales', industry: 'B2B SaaS', country: 'United States', companySizeMin: 51, companySizeMax: 200 };
  assert.equal(evaluateICP(rules({ targetTitles: ['VP Sales'], targetIndustries: ['B2B SaaS'], targetGeographies: ['US'], companySizeMin: 50, companySizeMax: 500 }), base).status, 'QUALIFIED');
  assert.equal(evaluateICP(rules({ excludedTitles: ['VP Sales'] }), base).status, 'REJECTED');
  assert.equal(evaluateICP(rules({ companySizeMin: 50, companySizeMax: 500 }), { ...base, companySizeMin: 1, companySizeMax: 10 }).status, 'NEEDS_REVIEW');
  assert.equal(evaluateICP(rules({ companySizeMin: 50, companySizeMax: 500 }), { ...base, companySizeMin: 201, companySizeMax: 1000 }).status, 'NEEDS_REVIEW');
  assert.equal(evaluateICP(rules({ companySizeMin: 50, companySizeMax: 500 }), { ...base, companySizeMin: null, companySizeMax: null }).status, 'NEEDS_REVIEW');
});
