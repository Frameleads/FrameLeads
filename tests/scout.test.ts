import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { getScoutProspect, listScoutProspects, resolveScoutUser, runScoutResearch } from '../src/lib/scout-data';
import { fitSummary, qualificationStatus, researchStatusDetail, safeEvidenceUrl, scoutPrimaryAction, scoutStatus, valueSummary, whyNowSummary } from '../src/lib/scout-view';

const root = join(__dirname, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

test('Scout authentication derives the tenant from verified Whop identity', async () => {
  let lookups = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ sub: 'whop-tenant-a', email: 'a@example.com' }), { status: 200 })) as typeof fetch;
  const db = { user: { findUnique: async ({ where }: { where: { whopId: string } }) => {
    lookups++;
    assert.deepEqual(where, { whopId: 'whop-tenant-a' });
    return { id: 'tenant-a', email: 'a@example.com', tier: 'CORE', whopId: 'whop-tenant-a' };
  } } };
  try {
    assert.equal(await resolveScoutUser(db as never, undefined), null);
    assert.equal(lookups, 0);
    assert.deepEqual(await resolveScoutUser(db as never, 'verified-whop-token'), { id: 'tenant-a', email: 'a@example.com', tier: 'CORE', whopId: 'whop-tenant-a' });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.match(source('src/app/dashboard/scout/page.tsx'), /if \(!user\) redirect\('\/login'\)/);
});

test('list and detail queries are tenant-scoped', async () => {
  const calls: unknown[] = [];
  const db = {
    prospect: {
      findMany: async (query: unknown) => { calls.push(query); return [{ id: 'p1', firstName: 'Sarah', lastName: 'Chen', companyName: 'ACME', intelligence: null }]; },
      findFirst: async (query: unknown) => { calls.push(query); return null; },
    },
  };
  const rows = await listScoutProspects(db as never, 'tenant-a');
  assert.equal(rows[0].researchStatus, 'NOT_RESEARCHED');
  assert.deepEqual((calls[0] as { where: unknown }).where, { userId: 'tenant-a' });
  assert.equal(await getScoutProspect(db as never, 'tenant-a', 'tenant-b-prospect'), null);
  assert.deepEqual((calls[1] as { where: unknown }).where, { id: 'tenant-b-prospect', userId: 'tenant-a' });
});

test('status actions distinguish unresearched, ready, failed, and review', () => {
  assert.equal(scoutPrimaryAction('NOT_RESEARCHED'), 'research');
  assert.equal(scoutPrimaryAction('READY'), 'view');
  assert.equal(scoutPrimaryAction('FAILED'), 'retry');
  assert.equal(scoutPrimaryAction('NEEDS_REVIEW'), 'view');
  assert.equal(scoutPrimaryAction('RESEARCHING'), 'busy');
  assert.notEqual(scoutStatus('NEEDS_REVIEW').tone, scoutStatus('FAILED').tone);
  assert.equal(whyNowSummary(null), 'No verified timing signal');
  assert.equal(scoutStatus('NOT_RESEARCHED').label, 'Not researched');
  assert.match(researchStatusDetail('NOT_RESEARCHED', 'UNASSESSED'), /Qualify first/);
  assert.match(researchStatusDetail('NOT_RESEARCHED', 'QUALIFIED'), /Run research/);
  assert.equal(scoutStatus('RESEARCHING').tone.includes('sky'), true);
  assert.equal(scoutStatus('NEEDS_REVIEW').tone.includes('amber'), true);
  assert.equal(scoutStatus('FAILED').tone.includes('red'), true);
  assert.equal(scoutStatus('READY').tone.includes('emerald'), true);
});

test('Scout distinguishes qualification from researched fit and keeps missing or invalid scores unassessed', () => {
  assert.deepEqual(fitSummary(null, null, 'NOT_RESEARCHED'), { label: 'Not assessed yet', tone: 'text-muted-foreground', detail: '' });
  assert.equal(fitSummary(101, 'STRONG', 'READY').label, 'Not assessed yet');
  assert.equal(fitSummary(82, 'STRONG', 'READY').tone, 'text-emerald-300');
  assert.equal(fitSummary(42, 'WEAK', 'READY').tone, 'text-red-300');
  assert.equal(valueSummary(null, 'UNASSESSED', 'NOT_RESEARCHED'), 'Awaiting qualification');
  assert.equal(valueSummary(null, 'QUALIFIED', 'NOT_RESEARCHED'), 'Awaiting research');
  assert.match(qualificationStatus('UNASSESSED', 'NONE', 'AUTO').detail, /Run qualification/);
  assert.equal(qualificationStatus('NEEDS_REVIEW', 'NO_RULES', 'AUTO').detail, 'ICP profile needs setup');
  assert.equal(qualificationStatus('NEEDS_REVIEW', 'MISSING_DATA', 'AUTO').detail, 'More prospect information needed');
  assert.equal(qualificationStatus('REJECTED', 'EXCLUDED', 'AUTO').tone.includes('red'), true);
  assert.equal(qualificationStatus('UNASSESSED', 'NONE', 'AUTO').tone.includes('red'), false);
});

test('research bridge passes only authenticated user and forceRefresh to the service', async () => {
  const inputs: unknown[] = [];
  const research = async (input: unknown) => { inputs.push(input); return { status: 'READY' }; };
  await runScoutResearch('tenant-a', 'p1', false, research);
  await runScoutResearch('tenant-a', 'p1', true, research);
  assert.deepEqual(inputs, [
    { userId: 'tenant-a', prospectId: 'p1', forceRefresh: false, overrideQualification: false },
    { userId: 'tenant-a', prospectId: 'p1', forceRefresh: true, overrideQualification: false },
  ]);
  await assert.rejects(runScoutResearch('', 'p1', false, research), /Authenticated userId/);
  assert.match(source('src/app/api/scout/research/route.ts'), /runScoutResearch\(user\.id, prospectId/);
});

test('source links require a safe URL and mobile cards are separate from desktop rows', () => {
  assert.equal(safeEvidenceUrl(null), null);
  assert.equal(safeEvidenceUrl('javascript:alert(1)'), null);
  assert.equal(safeEvidenceUrl('https://example.com/source'), 'https://example.com/source');
  const detail = source('src/app/dashboard/scout/ScoutDetail.tsx');
  assert.match(detail, /\{url && <a href=\{url\}/);
  const workspace = source('src/app/dashboard/scout/ScoutWorkspace.tsx');
  assert.match(workspace, /hidden overflow-hidden[^\n]*xl:block/);
  assert.match(workspace, /grid gap-3 sm:grid-cols-2 xl:hidden/);
  assert.match(workspace, /<article key=\{item\.id\}/);
});
