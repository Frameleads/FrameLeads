import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function compiled(relativePath) {
  return ts.transpileModule(
    readFileSync(new URL(relativePath, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
}

function loadSession(environment) {
  const mockProcess = { env: environment };
  const envExports = {};
  vm.runInNewContext(compiled('../src/lib/whop-environment.ts'), {
    exports: envExports, process: mockProcess, Error,
  });
  const sessionExports = {};
  vm.runInNewContext(compiled('../src/lib/customer-session.ts'), {
    exports: sessionExports,
    require: name => {
      if (name === './whop-environment') return envExports;
      if (name === 'next/headers') return { cookies: async () => ({ get: () => null }) };
      if (name === './prisma') return { prisma: {} };
      if (name === './auth-smoke-session') return {
        verifyAuthSmokeSession: () => null,
        isAuthSmokeSessionToken: () => false,
      };
      throw new Error('Unexpected session dependency: ' + name);
    },
    process: mockProcess, AbortSignal, Buffer, JSON, Error,
  });
  return sessionExports.verifyCustomerSession;
}

function fakeDb(expectedWhopId, user) {
  return { user: { findUnique: async ({ where }) => {
    assert.equal(where.whopId, expectedWhopId);
    return user;
  } } };
}

function validUserInfo() {
  return { ok: true, text: async () => JSON.stringify({
    sub: 'sandbox-buyer', email: 'buyer@example.invalid',
  }) };
}

test('Sandbox preview accepts only Sandbox userinfo, then resolves the verified Whop principal', async () => {
  const verify = loadSession({
    VERCEL_ENV: 'preview', NODE_ENV: 'production', WHOP_SANDBOX: 'true',
  });
  const calls = [];
  const buyer = { id: 'buyer-isolated', whopId: 'sandbox-buyer', tier: 'MICRO_PILOT' };
  const principal = await verify('sandbox-access-token', fakeDb('sandbox-buyer', buyer),
    async (url, options) => {
      calls.push(url);
      assert.equal(options.headers.authorization, 'Bearer sandbox-access-token');
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      return validUserInfo();
    });
  assert.equal(principal?.id, buyer.id);
  assert.deepEqual(calls, ['https://sandbox-api.whop.com/oauth/userinfo']);
});

test('Production session verification keeps the live Whop endpoint', async () => {
  const verify = loadSession({ VERCEL_ENV: 'production', NODE_ENV: 'production' });
  const calls = [];
  const principal = await verify('live-access-token',
    fakeDb('sandbox-buyer', { id: 'existing-live-account' }),
    async (url) => { calls.push(url); return validUserInfo(); });
  assert.equal(principal?.id, 'existing-live-account');
  assert.deepEqual(calls, ['https://api.whop.com/oauth/userinfo']);
});

test('Sandbox credentials cannot be used from a production deployment', async () => {
  const verify = loadSession({
    VERCEL_ENV: 'production', NODE_ENV: 'production', WHOP_SANDBOX: 'true',
  });
  let outbound = 0;
  const result = await verify('sandbox-access-token', { user: {
    findUnique: async () => { throw new Error('Must not resolve account'); },
  } }, async () => { outbound++; return validUserInfo(); });
  assert.equal(result, null);
  assert.equal(outbound, 0);
});

test('Sandbox 401 fails closed, never falls back to live Whop', async () => {
  const verify = loadSession({
    VERCEL_ENV: 'preview', NODE_ENV: 'production', WHOP_SANDBOX: 'true',
  });
  const calls = [];
  const result = await verify('rejected-token', { user: {
    findUnique: async () => { throw new Error('Must not access database after 401'); },
  } }, async (url) => { calls.push(url); return { ok: false, status: 401 }; });
  assert.equal(result, null);
  assert.deepEqual(calls, ['https://sandbox-api.whop.com/oauth/userinfo']);
});

test('Missing credentials never trigger network or database access', async () => {
  const verify = loadSession({
    VERCEL_ENV: 'preview', NODE_ENV: 'production', WHOP_SANDBOX: 'true',
  });
  let called = false;
  const call = async () => { called = true; throw new Error('unexpected outbound request'); };
  assert.equal(await verify(undefined, {}, call), null);
  assert.equal(await verify('x'.repeat(4097), {}, call), null);
  assert.equal(called, false);
});
