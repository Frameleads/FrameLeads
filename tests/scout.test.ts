import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { getScoutProspect, listScoutProspects, resolveScoutUser, runScoutResearch } from '../src/lib/scout-data';
import { safeEvidenceUrl, scoutPrimaryAction, scoutStatus, whyNowSummary } from '../src/lib/scout-view';

const root = join(__dirname, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

test('Scout authentication requires the existing session and email cookies', async () => {
  let lookups = 0;
  const db = { user: { findUnique: async () => { lookups++; return { id: 'tenant-a' }; } } };
  assert.equal(await resolveScoutUser(db as never, undefined, 'a@example.com'), null);
  assert.equal(await resolveScoutUser(db as never, 'session', undefined), null);
  assert.equal(lookups, 0);
  assert.deepEqual(await resolveScoutUser(db as never, 'session', ' A@EXAMPLE.COM '), { id: 'tenant-a' });
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
