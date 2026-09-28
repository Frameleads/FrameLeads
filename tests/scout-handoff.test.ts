import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { SandboxHandoffError, sendProspectToSandbox } from '../src/lib/prospects/sandbox-handoff';
import { scoutHandoffEligible } from '../src/lib/scout-view';

function fixture() {
  const prospect = { id: 'p1', userId: 'tenant-a', firstName: 'Sarah', lastName: 'Chen',
    companyName: 'Acme', websiteUrl: 'acme.example', linkedInUrl: null, email: 'sarah@acme.example' };
  const intelligence = { researchStatus: 'READY', fitScore: 82, whyFit: 'Stored assessment' };
  const leads: any[] = [];
  let qualification: any = { status: 'QUALIFIED', override: 'AUTO' };
  let prospectCreates = 0; let usageCreates = 0; let companyUpdates = 0;
  const tx = {
    prospect: {
      findUnique: async ({ where }: any) => where.userId_id.userId === prospect.userId && where.userId_id.id === prospect.id ? prospect : null,
      create: async () => { prospectCreates++; throw new Error('Handoff must not create a Prospect'); },
    },
    prospectIntelligence: { findUnique: async ({ where }: any) => where.userId_prospectId.userId === prospect.userId ? intelligence : null },
    generatedLead: {
      findFirst: async ({ where }: any) => leads.find(row => row.userId === where.userId && row.prospectId === where.prospectId) || null,
      create: async ({ data }: any) => { const lead = { id: `lead-${leads.length + 1}`, ...data }; leads.push(lead); return lead; },
    },
    companyIntelligence: { updateMany: async () => { companyUpdates++; throw new Error('Company cache must not change'); } },
    aIUsageEvent: { create: async () => { usageCreates++; throw new Error('No AI usage expected'); } },
  };
  const db = { ...tx, $transaction: async (work: any, options: any) => {
    assert.equal(options.isolationLevel, 'Serializable');
    return work(tx);
  } } as unknown as PrismaClient;
  const send = (userId = 'tenant-a') => sendProspectToSandbox({ userId, prospectId: 'p1' }, db, {
    qualify: async () => qualification,
  });
  return { send, db, prospect, intelligence, leads,
    setQualification: (value: any) => { qualification = value; },
    setResearch: (status: string) => { intelligence.researchStatus = status; },
    counts: () => ({ prospectCreates, usageCreates, companyUpdates }),
  };
}

test('qualified READY handoff creates one execution lead on the same Prospect and is idempotent', async () => {
  const f = fixture();
  const before = structuredClone(f.intelligence);
  const first = await f.send();
  assert.equal(first.prospectId, f.prospect.id);
  assert.equal(first.leadId, 'lead-1');
  assert.equal(first.reusedLead, false);
  assert.equal(first.destination, '/dashboard/sandbox?lead=lead-1');
  assert.equal(f.leads[0].prospectId, f.prospect.id);
  assert.equal(f.leads[0].emailDraft, '');
  const second = await f.send();
  assert.equal(second.leadId, first.leadId);
  assert.equal(second.reusedLead, true);
  assert.equal(f.leads.length, 1);
  assert.deepEqual(f.intelligence, before);
  assert.deepEqual(f.counts(), { prospectCreates: 0, usageCreates: 0, companyUpdates: 0 });
});

test('an existing lead linked to the Prospect is reused without rewriting its drafts', async () => {
  const f = fixture();
  f.leads.push({ id: 'campaign-lead', userId: 'tenant-a', prospectId: 'p1', emailDraft: 'Existing draft' });
  const result = await f.send();
  assert.equal(result.leadId, 'campaign-lead');
  assert.equal(result.reusedLead, true);
  assert.equal(f.leads.length, 1);
  assert.equal(f.leads[0].emailDraft, 'Existing draft');
});

test('excluded, rejected and review-needed qualifications are blocked before lead creation', async () => {
  for (const qualification of [
    { status: 'REJECTED', override: 'AUTO' },
    { status: 'NEEDS_REVIEW', override: 'AUTO' },
    { status: 'QUALIFIED', override: 'USER_EXCLUDED' },
  ]) {
    const f = fixture(); f.setQualification(qualification);
    await assert.rejects(f.send(), (error: unknown) => error instanceof SandboxHandoffError && error.reason === 'QUALIFICATION_REQUIRED');
    assert.equal(f.leads.length, 0);
  }
});

test('not researched and failed research cannot hand off; human qualification can', async () => {
  for (const status of ['NOT_RESEARCHED', 'FAILED', 'NEEDS_REVIEW']) {
    const f = fixture(); f.setResearch(status);
    await assert.rejects(f.send(), (error: unknown) => error instanceof SandboxHandoffError && error.reason === 'RESEARCH_REQUIRED');
    assert.equal(f.leads.length, 0);
  }
  const human = fixture(); human.setQualification({ status: 'QUALIFIED', override: 'USER_QUALIFIED' });
  assert.equal((await human.send()).prospectId, 'p1');
});

test('cross-tenant handoff is rejected before qualification or data access', async () => {
  const f = fixture();
  await assert.rejects(f.send('tenant-b'), (error: unknown) => error instanceof SandboxHandoffError && error.reason === 'NOT_FOUND');
  assert.equal(f.leads.length, 0);
});

test('Scout CTA is status-aware and mobile; route derives tenant and Sandbox focuses the selected lead', () => {
  const qualified = { status: 'QUALIFIED', override: 'AUTO', policyVersion: 1 };
  assert.equal(scoutHandoffEligible(qualified, 'READY'), true);
  assert.equal(scoutHandoffEligible({ ...qualified, override: 'USER_QUALIFIED', policyVersion: 0 }, 'READY'), true);
  assert.equal(scoutHandoffEligible({ ...qualified, override: 'USER_EXCLUDED' }, 'READY'), false);
  assert.equal(scoutHandoffEligible({ ...qualified, status: 'NEEDS_REVIEW' }, 'READY'), false);
  assert.equal(scoutHandoffEligible(qualified, 'FAILED'), false);
  assert.equal(scoutHandoffEligible(qualified, 'NOT_RESEARCHED'), false);
  const source = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
  assert.match(source('src/app/dashboard/scout/ScoutDetail.tsx'), /scoutHandoffEligible\(prospect\.qualification, status\)/);
  assert.match(source('src/app/dashboard/scout/SendToSandboxButton.tsx'), /className="w-full sm:w-auto"/);
  assert.match(source('src/app/api/scout/send-to-sandbox/route.ts'), /userId: user\.id/);
  assert.match(source('src/app/dashboard/sandbox/page.tsx'), /leadId \? \{ id: leadId \}/);
  assert.match(source('src/app/dashboard/sandbox/page.tsx'), /resolveScoutUser\(prisma, cookieStore\.get\('frameleads_session'\)/);
  assert.match(source('src/app/dashboard/sandbox/SandboxClient.tsx'), /if \(focusedLeadId\) return/);
  const generation = source('src/app/api/generate/route.ts');
  assert.match(generation, /ownedRegenerationLead = requestedLeadId[\s\S]*?generatedLead\.findFirst\(\{ where: \{ id: requestedLeadId, userId: currentUserId \} \}\)/);
  assert.match(generation, /\}, existingLead\?\.id, extractProspectMetadata\(lead\)\)/);
  const handoff = source('src/lib/prospects/sandbox-handoff.ts');
  assert.doesNotMatch(handoff, /researchProspectICP|recordAIUsage|generateContent/);
});
