import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash } from 'node:crypto';

const response = (body, init = {}) => ({ body, status: init.status ?? 200, headers: init.headers ?? {} });
function loadRoute(path, modules) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(output, { exports, require: name => {
    if (name in modules) return modules[name];
    if (name === 'node:crypto') return { createHash };
    throw new Error(`Unexpected dependency ${name}`);
  }, Request, URL, Buffer, process, console, Date, Map, Set, Promise });
  return exports;
}

test('Micro-Pilot can securely connect an IMAP mailbox without exposing its stored secret', async () => {
  const user = { id: 'tenant', imapEmail: null, imapHost: null, imapPort: null, imapPassword: null };
  let imapOptions;
  class ImapFlow {
    constructor(options) { imapOptions = options; this.usable = true; }
    on() {}
    async connect() {}
    async logout() {}
    close() {}
  }
  const route = loadRoute('../src/app/api/inbox/credentials/route.ts', {
    imapflow: { ImapFlow },
    'next/server': { NextResponse: { json: response } },
    '@/lib/prisma': { prisma: { user: { findUnique: async () => user, update: async ({ data }) => Object.assign(user, data) } } },
    '@/lib/auth-guard': { requireFeatureAccess: async feature => { assert.equal(feature, 'INBOX_TRIAGE'); return null; } },
    '@/lib/encryption': { encrypt: value => `encrypted:${value}` },
    '@/lib/imap-security': { resolvePublicImapHost: async host => { assert.equal(host, 'imap.example.com'); return { hostname: host, address: '203.0.113.8' }; } },
    '@/lib/customer-session': { verifiedCustomerUser: async () => ({ id: 'tenant' }) },
  });
  const connected = await route.POST(new Request('https://app.example/api/inbox/credentials', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ' OWNER@example.com ', host: 'imap.example.com', port: 993, appPassword: 'mail-secret' }) }));
  assert.equal(connected.status, 200);
  assert.equal(user.imapEmail, 'owner@example.com');
  assert.equal(user.imapPassword, 'encrypted:mail-secret');
  assert.equal(imapOptions.secure, true);
  assert.equal(imapOptions.tls.servername, 'imap.example.com');
  assert.equal(imapOptions.auth.pass, 'mail-secret');
  const status = await route.GET();
  assert.deepEqual(JSON.parse(JSON.stringify(status.body.mailbox)), { connected: true, email: 'owner@example.com', host: 'imap.example.com', port: 993 });
  assert.equal(JSON.stringify(status.body).includes('mail-secret'), false);
});

test('Micro-Pilot inbox sync saves raw replies, deduplicates repeats, and does not run paid AI classification', async () => {
  const savedSignals = [];
  const calls = { schedule: 0, classify: 0, created: 0, released: 0 };
  const user = { id: 'tenant', imapEmail: 'owner@example.com', imapPassword: 'encrypted-secret', imapHost: 'imap.example.com', imapPort: 993 };
  class ImapFlow {
    constructor() { this.usable = true; }
    on() {}
    async connect() {}
    async logout() {}
    close() {}
    async getMailboxLock() { return { release: () => calls.released++ }; }
    async search() { return [7]; }
    async *fetch(_uids, query) {
      if (query.envelope) yield { uid: 7, envelope: { from: [{ address: 'reply@example.com' }], messageId: '<reply-7@example.com>' } };
      else yield { uid: 7, source: Buffer.from('raw mime message') };
    }
  }
  const route = loadRoute('../src/app/api/inbox/sync/route.ts', {
    imapflow: { ImapFlow },
    mailparser: { simpleParser: async () => ({ from: { value: [{ address: 'reply@example.com' }] }, text: 'Raw buyer reply, please send details.', html: '',
      subject: 'Question', headers: { get: () => null } }) },
    'next/server': { NextResponse: { json: response } },
    '@/lib/prospects/persistence': { createInboundSignals: async (_db, signals) => {
      calls.created += signals.length;
      for (const signal of signals) savedSignals.push({ id: `signal-${savedSignals.length + 1}`, ...signal });
      return signals.map((signal, index) => ({ id: `signal-${savedSignals.length - signals.length + index + 1}`, ...signal }));
    } },
    '@/lib/prisma': { prisma: {
      user: { findUnique: async () => user },
      generatedLead: { findMany: async () => [{ id: 'lead-1', email: 'reply@example.com', firstName: 'R', lastName: 'P', companyName: 'Example' }] },
      inboundSignal: { findMany: async ({ where }) => savedSignals.filter(signal => where.sourceMessageId.in.includes(signal.sourceMessageId)).map(signal => ({ sourceMessageId: signal.sourceMessageId })) },
    } },
    '@/lib/auth-guard': { requireFeatureAccess: async feature => { assert.equal(feature, 'INBOX_TRIAGE'); return null; },
      getUserEntitlementTier: async id => { assert.equal(id, 'tenant'); return 'MICRO_PILOT'; } },
    '@/lib/pipeline-value': { DEFAULT_PIPELINE_VALUE: 0 },
    '@/lib/encryption': { decrypt: value => { assert.equal(value, 'encrypted-secret'); return 'mail-secret'; } },
    '@/lib/imap-security': { resolvePublicImapHost: async host => { assert.equal(host, 'imap.example.com'); return { hostname: host, address: '203.0.113.8' }; } },
    '@/app/api/triage/route': { POST: async () => { calls.classify++; return response({}, { status: 200 }); } },
    '@/lib/decision/schedule': { scheduleInboundDecisions: () => { calls.schedule++; } },
    '@/lib/customer-session': { verifiedCustomerUser: async () => ({ id: 'tenant' }) },
  });
  const first = await route.POST();
  const second = await route.POST();
  assert.equal(first.body.newSignalsAdded, 1);
  assert.equal(second.body.newSignalsAdded, 0);
  assert.equal(calls.created, 1);
  assert.equal(calls.schedule, 0);
  assert.equal(calls.classify, 0);
  assert.equal(savedSignals[0].rawEmail, 'Raw buyer reply, please send details.');
  assert.equal(savedSignals[0].signalAnalysis, null);
  assert.equal(savedSignals[0].aiDraft, '');
  assert.equal(calls.released, 2);
});
