import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash } from 'node:crypto';

function loadRoute(file, modules, extra = {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(output, { exports, require: name => {
    if (name in modules) return modules[name];
    if (name === 'node:crypto') return { createHash };
    throw new Error(`Unexpected dependency ${name}`);
  }, Request, URL, Buffer, process, console, Date, Map, Set, Promise, ...extra });
  return exports;
}
const response = (body, init = {}) => ({ body, status: init.status ?? 200, headers: init.headers ?? {} });
class LimitError extends Error { constructor(limit) { super(limit); this.limit = limit; } }
const post = (url, payload, origin = true) => new Request(`https://app.example${url}`, { method: 'POST',
  headers: { 'content-type': 'application/json', ...(origin ? { origin: 'https://app.example' } : {}) }, body: JSON.stringify(payload) });

test('synthetic Micro-Pilot journey: native send, reply sync, 3 decisions, raw message retention and Core upgrade CTA', async () => {
  const state = { user: { id: 'tenant', tier: 'MICRO_PILOT', imapEmail: null, imapHost: null, imapPort: null, imapPassword: null,
      rootBrandDomain: 'brand.example' }, sent: 0, signals: [], decisionClaims: new Set(), decisions: [], providerCalls: 0, classifications: 0 };
  const commonAuth = {
    '@/lib/auth-guard': { requireFeatureAccess: async () => null, getUserEntitlementTier: async () => 'MICRO_PILOT' },
    '@/lib/customer-session': { verifiedCustomerUser: async () => ({ id: 'tenant' }) },
    'next/server': { NextResponse: { json: response } },
  };

  const credentials = loadRoute('../src/app/api/inbox/credentials/route.ts', {
    ...commonAuth, imapflow: { ImapFlow: class { constructor(options) { assert.equal(options.secure, true); } on() {} async connect() {} async logout() {} close() {} } },
    '@/lib/prisma': { prisma: { user: { findUnique: async () => state.user, update: async ({ data }) => Object.assign(state.user, data) } } },
    '@/lib/encryption': { encrypt: value => `encrypted:${value}` },
    '@/lib/imap-security': { resolvePublicImapHost: async host => ({ hostname: host, address: '203.0.113.9' }) },
  });
  const connected = await credentials.POST(post('/api/inbox/credentials', { email: 'owner@outbound.example', host: 'imap.example.com', port: 993, appPassword: 'synthetic-secret' }));
  assert.equal(connected.status, 200);

  class InboxClient {
    constructor() { this.usable = true; }
    on() {} async connect() {} async logout() {} close() {}
    async getMailboxLock() { return { release() {} }; }
    async search() { return [1]; }
    async *fetch(_uids, query) {
      if (query.envelope) yield { uid: 1, envelope: { from: [{ address: 'reply@example.com' }], messageId: '<reply-1@example.com>' } };
      else yield { uid: 1, source: Buffer.from('raw-mime') };
    }
  }
  const sync = loadRoute('../src/app/api/inbox/sync/route.ts', {
    ...commonAuth, imapflow: { ImapFlow: InboxClient },
    mailparser: { simpleParser: async () => ({ from: { value: [{ address: 'reply@example.com' }] }, text: 'Please send the details.', html: '', subject: 'Interested', headers: { get: () => null } }) },
    '@/lib/prisma': { prisma: { user: { findUnique: async () => state.user },
      generatedLead: { findMany: async () => [{ id: 'lead-1', prospectId: 'prospect-1', email: 'reply@example.com', firstName: 'Reply', lastName: 'Person', companyName: 'Example' }] },
      inboundSignal: { findMany: async () => [] } } },
    '@/lib/prospects/persistence': { createInboundSignals: async (_db, signals) => signals.map(signal => {
      const saved = { id: `signal-${state.signals.length + 1}`, ...signal }; state.signals.push(saved); return saved;
    }) },
    '@/lib/pipeline-value': { DEFAULT_PIPELINE_VALUE: 0 },
    '@/lib/encryption': { decrypt: value => { assert.equal(value, 'encrypted:synthetic-secret'); return 'synthetic-secret'; } },
    '@/lib/imap-security': { resolvePublicImapHost: async host => ({ hostname: host, address: '203.0.113.9' }) },
    '@/app/api/triage/route': { POST: async () => { state.classifications++; return response({}); } },
    '@/lib/decision/schedule': { scheduleInboundDecisions: () => { state.classifications++; } },
  }, { createHash });
  const synced = await sync.POST();
  assert.equal(synced.status, 200);
  assert.equal(synced.body.newSignalsAdded, 1);
  assert.equal(state.signals[0].rawEmail, 'Please send the details.');
  assert.equal(state.classifications, 0, 'Micro-Pilot reply sync does not run paid background classification');

  const send = loadRoute('../src/app/api/email/send/route.ts', {
    ...commonAuth,
    '@/lib/prisma': { prisma: { user: { findUnique: async () => state.user }, generatedLead: { findFirst: async () => ({ id: 'lead-1', email: 'reply@example.com' }) } } },
    '@/lib/outbound/native-mail': { htmlToPlainText: value => value.replace(/<[^>]*>/g, ''), sendNativeEmail: async () => { throw Error('Core sender path must not be used'); }, NativeMailUnavailable: class extends Error {} },
    '@/lib/outbound/micro-pilot-sandbox-send': { MicroPilotSandboxSendError: class extends Error {}, sendMicroPilotSandboxEmail: async input => {
      assert.equal(input.userId, 'tenant'); assert.equal(input.leadId, 'lead-1'); assert.equal(input.to, 'reply@example.com'); assert.equal(input.confirmed, true);
      state.sent++; return { success: true, providerMessageId: 'synthetic-message' };
    } },
  });
  assert.equal((await send.POST(post('/api/email/send', { leadId: 'lead-1', to: 'reply@example.com', subject: 'Following up', htmlBody: '<p>Details</p>', confirmSend: true }))).status, 200);
  assert.equal(state.sent, 1);

  const decision = loadRoute('../src/app/api/decisions/triage/route.ts', {
    ...commonAuth,
    '@/lib/auth-guard': { featureAccessErrorForTier: () => ({ body: { error: 'locked' }, status: 403 }),
      getAuthenticatedEntitlementUser: async () => ({ id: 'tenant', tier: 'MICRO_PILOT' }) },
    '@/lib/decision/triage': { triageInboundSignal: async input => {
      assert.equal(input.microPilotReserved, true); state.providerCalls++;
      const item = { id: `decision-${state.decisions.length + 1}`, prospectId: input.signalId, source: 'GEMINI' };
      state.decisions.push(item); return { status: 'READY', decision: item };
    } },
    '@/lib/decision/rollout': { canManuallyAnalyze: () => true },
    '@/lib/automation/actions': { runAutopilot: async () => { throw Error('paid automation must stay locked'); } },
    '@/lib/response-sla/service': { syncResponseSLAForDecision: async () => ({}) },
    '@/lib/revenue-risk/service': { assessRevenueAtRisk: async () => ({}) },
    '@/lib/entitlements': { hasFeatureAccess: () => false },
    '@/lib/prisma': { prisma: { inboundSignal: { findFirst: async ({ where }) => state.signals.find(signal => signal.id === where.id) },
      decision: { findFirst: async ({ where }) => state.decisions.find(item => item.prospectId === where.prospectId) ?? null } } },
    '@/lib/decision/pending-recovery': { UNCERTAIN_ANALYSIS_REASON: 'ANALYSIS_OUTCOME_UNCERTAIN' },
    '@/lib/micro-pilot-limits': { MicroPilotLimitError: LimitError,
      reserveMicroPilotDecision: async (_userId, prospectId) => {
        if (state.decisionClaims.has(prospectId)) throw new LimitError('PROSPECT_ALREADY_USED');
        if (state.decisionClaims.size >= 3) throw new LimitError('DECISIONS_EXHAUSTED');
        state.decisionClaims.add(prospectId);
      }, releaseUnstartedMicroPilotDecision: async () => true },
  });
  for (let index = 0; index < 3; index++) {
    const signal = index === 0 ? state.signals[0] : { ...state.signals[0], id: `signal-${index + 1}`, prospectId: `prospect-${index + 1}` };
    signal.id = `signal-${index + 1}`; signal.prospectId = `prospect-${index + 1}`;
    if (index > 0) state.signals.push(signal);
    const result = await decision.POST(post('/api/decisions/triage', { signalId: signal.id }));
    assert.equal(result.status, 200);
  }
  state.signals.push({ ...state.signals[0], id: 'signal-fourth', prospectId: 'prospect-fourth' });
  const fourth = await decision.POST(post('/api/decisions/triage', { signalId: 'signal-fourth' }));
  assert.equal(fourth.status, 403);
  assert.equal(state.providerCalls, 3);
  assert.equal(state.signals[0].rawEmail, 'Please send the details.', 'original inbound content remains available after exhaustion');

  const packetUi = fs.readFileSync(new URL('../src/app/dashboard/inbox-triage/TriageCommandCenter.tsx', import.meta.url), 'utf8');
  const checkout = fs.readFileSync(new URL('../src/lib/checkout.ts', import.meta.url), 'utf8');
  assert.match(packetUi, /href=\{CORE_CHECKOUT_URL\}[\s\S]*?Upgrade to Core/);
  assert.match(packetUi, /Your three Micro-Pilot decision analyses have been used\. This original reply remains available to read\./);
  assert.match(checkout, /CORE_CHECKOUT_URL = 'https:\/\/whop\.com\/checkout\/plan_sAEhr77rTrhX4'/);
});
