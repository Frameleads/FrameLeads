import test from 'node:test';
import assert from 'node:assert/strict';
import { sendMicroPilotSandboxEmail, MicroPilotSandboxSendError } from '../src/lib/outbound/micro-pilot-sandbox-send';

function fixture(): any {
  const state: any = { claims: new Map(), logs: [], sends: 0, suppression: false, hold: false, claimStatus: 'COMPLETED', dailySent: 0,
    aliasLeadIds: [], tier: 'MICRO_PILOT', rootBrandDomain: 'brand.example' };
  const user: any = { id: 'tenant', get tier() { return state.tier; }, imapEmail: 'owner@outbound.example', get rootBrandDomain() { return state.rootBrandDomain; } };
  const lead: any = { id: 'lead-1', userId: 'tenant', prospectId: 'prospect-1', email: 'buyer@example.com',
    linkedInUrl: 'https://linkedin.com/in/buyer', firstName: 'Buyer', lastName: 'Person', companyName: 'Acme', websiteUrl: 'acme.example' };
  const prospect: any = { ...lead, id: 'prospect-1' };
  const db: any = {
    user: { findUnique: async () => user },
    generatedLead: { findFirst: async ({ where }: any) => where.userId === lead.userId && (where.id === lead.id || state.aliasLeadIds.includes(where.id))
      ? { ...lead, id: where.id } : null },
    prospect: { findUnique: async () => prospect },
    microPilotOutboundClaim: { findUnique: async () => state.claimStatus ? { status: state.claimStatus } : null },
    prospectHold: { findUnique: async () => state.hold ? { active: true } : null },
    inboundSignal: { findFirst: async () => state.suppression ? { id: 'unsubscribe' } : null },
    decision: { findFirst: async () => null },
    microPilotNativeSendClaim: {
      findUnique: async ({ where }: any) => state.claims.get(where.userId_prospectId.prospectId) ?? null,
      create: async ({ data }: any) => { if ([...state.claims.values()].some((c: any) => c.prospectId === data.prospectId || c.identityKey === data.identityKey)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        const claim = { ...data, status: 'RESERVED' }; state.claims.set(data.prospectId, claim); return claim; },
      count: async () => [...state.claims.values()].filter(c => ['RESERVED', 'UNCERTAIN'].includes(c.status)).length,
      update: async ({ where, data }: any) => { const claim = state.claims.get(where.userId_prospectId.prospectId); Object.assign(claim, data); return claim; },
      delete: async ({ where }: any) => ({ count: state.claims.delete(where.userId_prospectId.prospectId) ? 1 : 0 }),
    },
    outboundLog: { count: async () => state.dailySent + state.logs.length,
      create: async ({ data }: any) => { const log = { id: `log-${state.logs.length + 1}`, sentAt: new Date(), ...data }; state.logs.push(log); return log; } },
    sendingInbox: { findFirst: async () => ({ id: 'inbox-1' }), create: async ({ data }: any) => ({ id: 'inbox-1', ...data }) },
    $queryRaw: async () => [],
    $transaction: async (work: any) => work(db),
  };
  const evaluate: any = async () => ({ configurationMissing: false, blockingRules: [], unresolvedRules: [],
    humanReviewRequirements: [], safeResponseRequirements: [] });
  const sender: any = async (input: any) => { state.sends++; input.onDispatchStart?.(); return { provider: 'NATIVE_SMTP', providerMessageId: 'message-1' }; };
  const send = (overrides: any = {}) => sendMicroPilotSandboxEmail({ userId: 'tenant', leadId: 'lead-1', to: 'buyer@example.com',
    subject: 'Hello', text: 'Hello there', html: '<p>Hello there</p>', confirmed: true, ...overrides }, { db, sender, evaluate,
    now: () => new Date('2026-10-25T12:00:00Z'), recordMemory: async () => undefined });
  return { state, db, send };
}

test('one confirmed Sandbox send succeeds for an owned, quota-claimed Micro-Pilot prospect', async () => {
  const f = fixture();
  assert.deepEqual(await f.send(), { success: true, providerMessageId: 'message-1' });
  assert.equal(f.state.sends, 1);
  assert.equal(f.state.claims.get('prospect-1').status, 'SENT');
  assert.equal(f.state.logs.length, 1);
});

test('arbitrary recipients, unclaimed prospects, suppression, and missing human confirmation are rejected', async () => {
  const wrongRecipient = fixture();
  await assert.rejects(wrongRecipient.send({ to: 'other@example.com' }),
    error => error instanceof MicroPilotSandboxSendError && error.reason === 'RECIPIENT_MISMATCH');
  assert.equal(wrongRecipient.state.sends, 0);
  const foreign = fixture(); foreign.db.generatedLead.findFirst = async () => null;
  await assert.rejects(foreign.send(), error => error instanceof MicroPilotSandboxSendError && error.reason === 'LEAD_NOT_ELIGIBLE');
  const upgraded = fixture(); upgraded.state.tier = 'CORE';
  await assert.rejects(upgraded.send(), error => error instanceof MicroPilotSandboxSendError && error.reason === 'NOT_MICRO_PILOT');
  const unclaimed = fixture(); unclaimed.state.claimStatus = null;
  await assert.rejects(unclaimed.send(), error => error instanceof MicroPilotSandboxSendError && error.reason === 'LEAD_NOT_ELIGIBLE');
  const suppressed = fixture(); suppressed.state.suppression = true;
  await assert.rejects(suppressed.send(), error => error instanceof MicroPilotSandboxSendError && error.reason === 'SUPPRESSED');
  const unconfirmed = fixture();
  await assert.rejects(unconfirmed.send({ confirmed: false }), /Explicit send confirmation required/);
  assert.equal(unconfirmed.state.sends, 0);
});

test('Domain Armor requires a configured root domain and blocks sending from the protected root', async () => {
  const missing = fixture(); missing.state.rootBrandDomain = '';
  await assert.rejects(missing.send(), error => error instanceof MicroPilotSandboxSendError && error.reason === 'SENDER_DOMAIN_NOT_CONFIGURED');
  const protectedRoot = fixture(); protectedRoot.state.rootBrandDomain = 'outbound.example';
  await assert.rejects(protectedRoot.send(), error => error instanceof MicroPilotSandboxSendError && error.reason === 'SENDER_DOMAIN_BLOCKED');
  assert.equal(protectedRoot.state.sends, 0);
});

test('repeat sends and uncertain SMTP outcomes cannot duplicate dispatch', async () => {
  const f = fixture();
  await f.send();
  await assert.rejects(f.send(), error => error instanceof MicroPilotSandboxSendError && error.reason === 'ALREADY_SENT');
  f.state.aliasLeadIds.push('duplicate-lead');
  await assert.rejects(f.send({ leadId: 'duplicate-lead' }), error => error instanceof MicroPilotSandboxSendError && error.reason === 'ALREADY_SENT');
  assert.equal(f.state.sends, 1);
  const uncertain = fixture();
  const failAfterStart: any = async (input: any) => { input.onDispatchStart?.(); throw new Error('SMTP outcome uncertain'); };
  await assert.rejects(sendMicroPilotSandboxEmail({ userId: 'tenant', leadId: 'lead-1', to: 'buyer@example.com',
    subject: 'Hello', text: 'Hello', html: '<p>Hello</p>', confirmed: true }, { db: uncertain.db, sender: failAfterStart,
    evaluate: (async () => ({ configurationMissing: false, blockingRules: [], unresolvedRules: [], humanReviewRequirements: [], safeResponseRequirements: [] })) as any,
    recordMemory: async () => undefined }));
  assert.equal(uncertain.state.claims.get('prospect-1').status, 'UNCERTAIN');
  await assert.rejects(uncertain.send(), error => error instanceof MicroPilotSandboxSendError && error.reason === 'ALREADY_SENT');
});

test('pre-dispatch failure releases the reservation; daily send cap and suppression holds fail closed', async () => {
  const f = fixture();
  const failBeforeStart: any = async () => { throw new Error('SMTP setup failed before dispatch'); };
  await assert.rejects(sendMicroPilotSandboxEmail({ userId: 'tenant', leadId: 'lead-1', to: 'buyer@example.com',
    subject: 'Hello', text: 'Hello', html: '<p>Hello</p>', confirmed: true }, { db: f.db, sender: failBeforeStart,
    evaluate: (async () => ({ configurationMissing: false, blockingRules: [], unresolvedRules: [], humanReviewRequirements: [], safeResponseRequirements: [] })) as any,
    recordMemory: async () => undefined }));
  assert.equal(f.state.claims.has('prospect-1'), false);
  const held = fixture(); held.state.hold = true;
  await assert.rejects(held.send(), error => error instanceof MicroPilotSandboxSendError && error.reason === 'SUPPRESSED');
  const capped = fixture(); capped.state.dailySent = 30;
  await assert.rejects(capped.send(), error => error instanceof MicroPilotSandboxSendError && error.reason === 'DAILY_LIMIT_REACHED');
  assert.equal(capped.state.sends, 0);
});
