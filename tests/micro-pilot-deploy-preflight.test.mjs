import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture(tier) {
  const calls = { inbox: 0, preflight: 0, record: 0 };
  const modules = {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    '@/lib/prisma': { prisma: { user: { findUnique: async () => ({ id: 'tenant', tier, rootBrandDomain: 'brand.example' }) },
      sendingInbox: { findUnique: async () => { calls.inbox++; return { id: 'inbox', userId: 'tenant', emailAddress: 'sender@outbound.example' }; } } } },
    '@/lib/domain-armor': { validateSenderDomain: () => ({ passed: true }) },
    '@/lib/throttle-protocol': { preflightBatchCheck: async () => { calls.preflight++; return { allowed: true, deployableCount: 1, sentToday: 0, dailyLimit: 30, remaining: 30 }; },
      recordSend: async () => { calls.record++; } },
    '@/lib/auth-guard': { requireFeatureAccess: async () => null },
    '@/lib/customer-session': { verifiedCustomerUser: async () => ({ id: 'tenant' }) },
  };
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(new URL('../src/app/api/deploy/preflight/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(output, { exports, require: name => modules[name], Request, console, Promise });
  return { route: exports, calls };
}
const request = () => new Request('https://app.example/api/deploy/preflight', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ inboxId: 'inbox', batchId: 'batch', leadIds: ['lead-1'] }) });

test('Micro-Pilot legacy preflight is rejected before inbox or outbound ledger access', async () => {
  const f = fixture('MICRO_PILOT');
  const result = await f.route.POST(request());
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'MICRO_PILOT_SANDBOX_ONLY');
  assert.deepEqual(f.calls, { inbox: 0, preflight: 0, record: 0 });
});

test('Core and Enterprise retain existing preflight behavior', async () => {
  for (const tier of ['CORE', 'ENTERPRISE']) {
    const f = fixture(tier);
    const result = await f.route.POST(request());
    assert.equal(result.status, 200);
    assert.equal(f.calls.record, 1);
  }
});
