import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { unwrapWebhook, WebhookVerificationError } from '@whop/sdk/helpers';

function sign(secret, id, timestamp, body) {
  return createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(`${id}.${timestamp}.${body}`, 'utf8').digest('base64');
}

test('current Whop Standard Webhooks signature accepts a real synthetic envelope', () => {
  const secret = 'ws_test-auth-hotfix-secret';
  const id = 'msg_synthetic_123';
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id, type: 'membership.went_valid', data: { user_id: 'whop-test-a' } });
  const headers = {
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': `v1,${sign(secret, id, timestamp, body)}`,
  };
  assert.deepEqual(unwrapWebhook(body, { headers, key: secret }), JSON.parse(body));
  assert.throws(() => unwrapWebhook(body, { headers, key: 'ws_other-test-secret' }));
  assert.throws(() => unwrapWebhook(`${body} `, { headers, key: secret }));
  assert.throws(() => unwrapWebhook(body, { headers: { ...headers, 'webhook-timestamp': String(timestamp - 301) }, key: secret }));
  assert.throws(() => unwrapWebhook(body, { headers: { ...headers, 'webhook-timestamp': String(timestamp + 301) }, key: secret }));
});

function loadProcessor() {
  const exports = {};
  const calls = { invalidations: [], receipts: new Set() };
  const module = ts.transpileModule(readFileSync(new URL('../src/lib/whop-webhook-processing.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(module, {
    exports,
    require: name => name === './auth-guard'
      ? { invalidateWhopEntitlementCache: whopId => calls.invalidations.push(whopId) }
      : { membershipSubject: payload => ({ whopId: payload.data?.user?.id || payload.data?.user_id }) },
  });
  return { processor: exports, calls };
}

function fakeTransaction(calls) {
  return {
    whopWebhookReceipt: { create: async ({ data }) => {
      if (calls.receipts.has(data.webhookId)) throw { code: 'P2002' };
      calls.receipts.add(data.webhookId);
    } },
    user: { updateMany: async () => { throw new Error('Webhooks must not write entitlement state'); } },
  };
}

test('verified direct Whop membership event invalidates freshness cache and duplicate IDs are rejected', async () => {
  const { processor, calls } = loadProcessor();
  const tx = fakeTransaction(calls);
  const event = { data: { id: 'mem_123', user: { id: 'whop-test-a', email: 'a@example.invalid' }, status: 'active', cancel_at_period_end: false } };
  await processor.applyVerifiedWhopEvent(tx, 'msg_once', 'membership.went_valid', event);
  assert.deepEqual(calls.invalidations, ['whop-test-a']);
  await assert.rejects(processor.applyVerifiedWhopEvent(tx, 'msg_once', 'membership.went_valid', event), error => error.code === 'P2002');
  assert.equal(calls.invalidations.length, 1);
});

test('period-end cancellation event invalidates cached state but does not revoke from one membership payload', async () => {
  const { processor, calls } = loadProcessor();
  await processor.applyVerifiedWhopEvent(fakeTransaction(calls), 'msg_cancel', 'membership.cancel_at_period_end_changed', {
    data: { id: 'mem_123', user_id: 'whop-test-a', status: 'active', cancel_at_period_end: true, renewal_period_end: '2030-01-01T00:00:00.000Z' },
  });
  assert.deepEqual(calls.invalidations, ['whop-test-a']);
});

test('failed payment and refund events invalidate membership freshness without trusting event order', async () => {
  const { processor, calls } = loadProcessor();
  for (const eventType of ['payment.failed', 'payment.refunded', 'refund.created']) {
    await processor.applyVerifiedWhopEvent(fakeTransaction(calls), `msg_${eventType}`, eventType, {
      data: { id: 'payment_test', user_id: 'whop-test-a' },
    });
  }
  assert.deepEqual(calls.invalidations, ['whop-test-a', 'whop-test-a', 'whop-test-a']);
});

test('OAuth and signed webhook merges refuse conflicting Whop-ID/email tenants', async () => {
  const exports = {};
  const source = readFileSync(new URL('../src/lib/whop-user.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    exports,
    require: name => name === '@prisma/client' ? { Prisma: { TransactionIsolationLevel: { Serializable: 'Serializable' } } }
      : { prisma: {} },
  });
  let updates = 0;
  let creates = 0;
  const tx = {
    user: {
      findUnique: async ({ where }) => where.whopId ? { id: 'tenant-a', whopId: 'whop-a', email: 'a@example.invalid' }
        : { id: 'tenant-b', whopId: 'whop-b', email: 'b@example.invalid' },
      update: async () => { updates++; },
      create: async () => { creates++; },
    },
  };
  await assert.rejects(exports.mergeWhopUserInTransaction(tx, {
    whopId: 'whop-a', email: 'b@example.invalid', subscription: { tier: 'CORE', monthlyQuota: 500 },
  }), /conflicts with an existing account/);
  assert.equal(updates, 0);
  assert.equal(creates, 0);
});

test('email-cookie identity paths are removed and dashboard data pages resolve the verified principal', () => {
  const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const files = [
    'src/app/api/lists/route.ts', 'src/app/api/lists/[id]/route.ts', 'src/app/api/lists/[id]/duplicate/route.ts',
    'src/app/api/leads/[id]/route.ts', 'src/app/api/leads/[id]/move/route.ts', 'src/app/api/leads/clear/route.ts',
    'src/app/api/inbox/sync/route.ts', 'src/app/api/inbox/credentials/route.ts', 'src/app/api/calendar/book/route.ts',
    'src/app/api/dispatch/route.ts', 'src/app/api/email/send/route.ts', 'src/app/api/triage/route.ts',
    'src/app/api/triage/approve/route.ts', 'src/app/api/triage/archive/route.ts', 'src/app/api/governance/metrics/route.ts',
    'src/app/api/deploy/preflight/route.ts',
  ];
  for (const file of files) {
    const route = source(file);
    assert.doesNotMatch(route, /user_email|where:\s*\{\s*email:/, `${file} must not trust email cookies`);
    assert.match(route, /verifiedCustomerUser|resolveScoutUser|requireFeatureAccess/, `${file} must use verified auth`);
  }
  const middleware = source('src/middleware.ts');
  assert.match(middleware, /matcher: \["\/dashboard\/:path\*", "\/welcome"\]/);
  assert.doesNotMatch(middleware, /auth-smoke|test-session|bypass/i);
  const preflight = source('src/app/api/deploy/preflight/route.ts');
  assert.match(preflight, /requestedUserId && requestedUserId !== principal\.id/);
  assert.match(preflight, /const userId = principal\.id/);
  assert.match(preflight, /user\.tier === 'MICRO_PILOT'/);
  assert.match(preflight, /MICRO_PILOT_SANDBOX_ONLY/);
  assert.match(preflight, /if \(user\.tier === 'MICRO_PILOT'\)[\s\S]*?return NextResponse\.json[\s\S]*?MICRO_PILOT_SANDBOX_ONLY[\s\S]*?const inbox/);
});

test('signed smoke sessions are local development only, short-lived, and restricted to synthetic tenants', async () => {
  const helperExports = {};
  const helperText = readFileSync(new URL('../src/lib/auth-smoke-session.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(helperText, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: helperExports,
    require: name => name === 'node:crypto' ? { createHmac, timingSafeEqual } : require(name),
    process: { env: { NODE_ENV: 'development' } }, Buffer, Date, JSON,
  });
  const secret = 'synthetic-auth-smoke-secret-at-least-32-bytes';
  const now = Date.now();
  const token = helperExports.createAuthSmokeSession('c1234567890abcdef12345678', secret, now);
  assert.equal(helperExports.verifyAuthSmokeSession(token, secret, now), 'c1234567890abcdef12345678');
  assert.equal(helperExports.verifyAuthSmokeSession(`${token}x`, secret, now), null);
  assert.equal(helperExports.verifyAuthSmokeSession(token, secret, now + 901_000), null);

  const productionExports = {};
  vm.runInNewContext(ts.transpileModule(helperText, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: productionExports,
    require: name => name === 'node:crypto' ? { createHmac, timingSafeEqual } : require(name),
    process: { env: { NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production' } }, Buffer, Date, JSON,
  });
  assert.equal(productionExports.verifyAuthSmokeSession(token, secret, now), null);
  assert.throws(() => productionExports.createAuthSmokeSession('c1234567890abcdef12345678', secret, now), /DISABLED/);

  const customerExports = {};
  const customerSource = readFileSync(new URL('../src/lib/customer-session.ts', import.meta.url), 'utf8');
  const syntheticUser = { id: 'c1234567890abcdef12345678', email: 'auth-smoke-a@frameleads.invalid', tier: 'CORE', whopId: 'auth-smoke:a' };
  let where;
  vm.runInNewContext(ts.transpileModule(customerSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: customerExports,
    require: name => name === 'next/headers' ? { cookies: async () => ({ get: () => ({ value: token }) }) }
      : name === './prisma' ? { prisma: {} }
        : name === './auth-smoke-session' ? helperExports : {},
    process: { env: { NODE_ENV: 'development', AUTH_SMOKE_SESSION_SECRET: secret } }, Buffer, AbortSignal,
    fetch: async () => { throw new Error('A test session must not be sent to Whop'); },
  });
  const principal = await customerExports.verifyCustomerSession(token, {
    user: { findFirst: async args => { where = args.where; return syntheticUser; } },
  });
  assert.equal(principal.id, syntheticUser.id);
  assert.deepEqual(JSON.parse(JSON.stringify(where)), {
    id: syntheticUser.id,
    email: { endsWith: '@frameleads.invalid' },
    whopId: { startsWith: 'auth-smoke:' },
  });
});

function loadRouteWithVerifiedSession(routePath, cookies, db) {
  const customerExports = {};
  const customerSource = readFileSync(new URL('../src/lib/customer-session.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(customerSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: customerExports,
    require: name => name === 'next/headers' ? { cookies: async () => ({ get: key => cookies[key] ? { value: cookies[key] } : undefined }) }
      : name === './prisma' ? { prisma: db }
        : { verifyAuthSmokeSession: () => null, isAuthSmokeSessionToken: () => false },
    fetch: async (_url, options) => {
      if (options.headers.authorization !== 'Bearer signed-token-a') return { ok: false };
      return { ok: true, text: async () => JSON.stringify({ sub: 'whop-tenant-a', email: 'a@example.invalid' }) };
    },
    process: { env: {} }, AbortSignal, Buffer,
  });

  const routeExports = {};
  const source = readFileSync(new URL(`../${routePath}`, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    exports: routeExports,
    require: name => name === 'next/server' ? { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } }
      : name === '@/lib/prisma' ? { prisma: db }
        : name === '@/lib/customer-session' ? customerExports
          : name === '@prisma/client' ? { LeadSourceType: { UNKNOWN: 'UNKNOWN' } } : {},
    console,
  });
  return routeExports;
}

test('legitimate Whop login reads only tenant A despite a forged tenant B email cookie', async () => {
  const calls = [];
  const db = {
    user: { findUnique: async ({ where }) => { assert.deepEqual(JSON.parse(JSON.stringify(where)), { whopId: 'whop-tenant-a' }); return { id: 'tenant-a', email: 'a@example.invalid' }; } },
    leadList: { findMany: async ({ where }) => { calls.push(where.userId); return [{ id: 'list-a', userId: where.userId }]; } },
  };
  const route = loadRouteWithVerifiedSession('src/app/api/lists/route.ts', {
    frameleads_session: 'signed-token-a', user_email: 'b@example.invalid',
  }, db);
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['tenant-a']);
  assert.deepEqual(response.body.lists, [{ id: 'list-a', userId: 'tenant-a' }]);
});

test('authenticated tenant A cannot rename tenant B list using mismatched email cookie', async () => {
  let updated = false;
  const db = {
    user: { findUnique: async () => ({ id: 'tenant-a', email: 'a@example.invalid' }) },
    leadList: {
      findFirst: async args => { assert.deepEqual(JSON.parse(JSON.stringify(args.where)), { id: 'list-b', userId: 'tenant-a' }); return null; },
      update: async () => { updated = true; throw new Error('Must not mutate'); },
    },
  };
  const route = loadRouteWithVerifiedSession('src/app/api/lists/[id]/route.ts', {
    frameleads_session: 'signed-token-a', user_email: 'b@example.invalid',
  }, db);
  const response = await route.PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ name: 'attacker' }) }), {
    params: Promise.resolve({ id: 'list-b' }),
  });
  assert.equal(response.status, 404);
  assert.equal(updated, false);
});

function loadWebhookRoute(secret, calls) {
  class PrismaClientKnownRequestError extends Error {
    constructor(code) { super(code); this.code = code; }
  }
  const routeExports = {};
  const source = readFileSync(new URL('../src/app/api/webhooks/whop/route.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    exports: routeExports,
    require: name => name === '@whop/sdk/helpers' ? { unwrapWebhook, WebhookVerificationError }
      : name === '@prisma/client' ? { Prisma: { PrismaClientKnownRequestError, TransactionIsolationLevel: { Serializable: 'Serializable' } } }
        : name === 'next/server' ? { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } }
          : name === '@/lib/prisma' ? { prisma: { $transaction: async callback => { calls.transactions++; return callback({}); } } }
            : name === '@/lib/whop-webhook-processing' ? { applyVerifiedWhopEvent: async (...args) => calls.events.push(args) }
              : {},
    process: { env: secret ? { WHOP_WEBHOOK_SECRET: secret } : {} }, Buffer, console,
  });
  return routeExports;
}

test('webhook route rejects forged signatures before database work and processes one fresh signed delivery', async () => {
  const secret = 'ws_route-test-secret';
  const calls = { transactions: 0, events: [] };
  const route = loadWebhookRoute(secret, calls);
  const id = 'msg_route_test';
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: 'event_separate_from_delivery_id', type: 'membership.went_valid', data: { user_id: 'synthetic-whop-user' } });
  const headers = {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': `v1,${sign('ws_wrong-secret', id, timestamp, body)}`,
  };
  const forged = await route.POST(new Request('http://localhost/api/webhooks/whop', { method: 'POST', headers, body }));
  assert.equal(forged.status, 401);
  assert.equal(calls.transactions, 0);

  headers['webhook-signature'] = `v1,${sign(secret, id, timestamp, body)}`;
  const accepted = await route.POST(new Request('http://localhost/api/webhooks/whop', { method: 'POST', headers, body }));
  assert.equal(accepted.status, 200);
  assert.equal(calls.transactions, 1);
  assert.equal(calls.events.length, 1);
});
