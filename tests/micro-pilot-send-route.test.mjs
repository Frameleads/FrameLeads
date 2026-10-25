import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadRoute(modules) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(new URL('../src/app/api/email/send/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(output, { exports, require: name => {
    if (name in modules) return modules[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, Request, URL, process, console, Promise });
  return exports;
}
function fixture(tier = 'MICRO_PILOT') {
  const calls = { native: 0, micro: 0, payload: null };
  const modules = {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    '@/lib/prisma': { prisma: { user: { findUnique: async () => ({ id: 'tenant', imapEmail: 'owner@example.com',
      imapPassword: 'cipher', imapHost: 'imap.example.com' }) },
      generatedLead: { findFirst: async () => ({ id: 'lead-1', email: 'buyer@example.com' }) } } },
    '@/lib/outbound/native-mail': { htmlToPlainText: html => html.replace(/<[^>]*>/g, ''),
      sendNativeEmail: async () => { calls.native++; return {}; }, NativeMailUnavailable: class NativeMailUnavailable extends Error {} },
    '@/lib/auth-guard': { requireFeatureAccess: async () => null, getUserEntitlementTier: async () => tier },
    '@/lib/customer-session': { verifiedCustomerUser: async () => ({ id: 'tenant' }) },
    '@/lib/outbound/micro-pilot-sandbox-send': {
      MicroPilotSandboxSendError: class MicroPilotSandboxSendError extends Error { constructor(reason) { super(reason); this.reason = reason; } },
      sendMicroPilotSandboxEmail: async payload => { calls.micro++; calls.payload = payload;
        if (payload.to !== 'buyer@example.com') throw new modules['@/lib/outbound/micro-pilot-sandbox-send'].MicroPilotSandboxSendError('RECIPIENT_MISMATCH');
        return { success: true, providerMessageId: 'msg-1' }; },
    },
  };
  return { route: loadRoute(modules), calls };
}
const request = (payload, origin = 'https://app.example') => new Request('https://app.example/api/email/send', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(payload),
});
const valid = { leadId: 'lead-1', to: 'buyer@example.com', subject: 'Hello', htmlBody: '<p>Hi</p>', confirmSend: true };

test('Sandbox human-confirmed Micro-Pilot send uses the native limited prospect service', async () => {
  const f = fixture();
  const result = await f.route.POST(request(valid));
  assert.equal(result.status, 200);
  assert.equal(f.calls.micro, 1);
  assert.equal(f.calls.native, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.payload)), {
    userId: 'tenant', leadId: 'lead-1', to: 'buyer@example.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi', confirmed: true,
  });
});

test('Micro-Pilot API rejects missing confirmation, missing same-origin header, unauthenticated user, and arbitrary recipients', async () => {
  const f = fixture();
  assert.equal((await f.route.POST(request({ ...valid, confirmSend: false }))).status, 400);
  assert.equal((await f.route.POST(request(valid, null))).status, 403);
  assert.equal((await f.route.POST(request({ ...valid, to: 'attacker@example.com' }))).status, 403);
  assert.equal(f.calls.micro, 1);
  const unauthenticated = fixture();
  unauthenticated.route = loadRoute({
    ...{
      'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
      '@/lib/prisma': { prisma: { user: { findUnique: async () => null } } },
      '@/lib/outbound/native-mail': { htmlToPlainText: html => html, sendNativeEmail: async () => {}, NativeMailUnavailable: class extends Error {} },
      '@/lib/auth-guard': { requireFeatureAccess: async () => null, getUserEntitlementTier: async () => 'MICRO_PILOT' },
      '@/lib/customer-session': { verifiedCustomerUser: async () => null },
      '@/lib/outbound/micro-pilot-sandbox-send': { MicroPilotSandboxSendError: class extends Error {}, sendMicroPilotSandboxEmail: async () => { throw Error('unreachable'); } },
    },
  });
  assert.equal((await unauthenticated.route.POST(request(valid))).status, 401);
});

test('Core and Enterprise retain the existing owned-lead native send path', async () => {
  for (const tier of ['CORE', 'ENTERPRISE']) {
    const f = fixture(tier);
    const result = await f.route.POST(request({ to: 'buyer@example.com', subject: 'Hello', htmlBody: '<p>Hi</p>' }));
    assert.equal(result.status, 200);
    assert.equal(f.calls.native, 1);
    assert.equal(f.calls.micro, 0);
  }
});
