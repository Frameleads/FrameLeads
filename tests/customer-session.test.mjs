import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/customer-session.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports,
  require: name => name === 'next/headers'
    ? { cookies: () => { throw Error('No browser session in test'); } }
    : name === './auth-smoke-session'
      ? { verifyAuthSmokeSession: () => null, isAuthSmokeSessionToken: () => false }
      : { prisma: {} },
  process: { env: {} },
  fetch: () => { throw Error('Network must be injected'); },
  AbortSignal,
});

test('missing, forged, expired, and mismatched token profiles fail closed', async () => {
  const db = { user: { findUnique: () => { throw Error('Unauthenticated database lookup'); } } };
  assert.equal(await exports.verifyCustomerSession(undefined, db), null);
  assert.equal(await exports.verifyCustomerSession('forged-cookie', db, async () => ({ ok: false })), null);
  assert.equal(await exports.verifyCustomerSession('bad-profile', db, async () => ({ ok: true, text: async () => '{' })), null);
  assert.equal(await exports.verifyCustomerSession('oversized', db, async () => ({ ok: true, text: async () => 'x'.repeat(8001) })), null);
});

test('verified Whop subject alone selects one tenant; profile/browser email cannot select another', async () => {
  const tenants = new Map([
    ['whop-tenant-a', { id: 'tenant-a', email: 'a@example.invalid', tier: 'CORE' }],
    ['whop-tenant-b', { id: 'tenant-b', email: 'b@example.invalid', tier: 'CORE' }],
  ]);
  const db = { user: { findUnique: async ({ where }) => {
    assert.deepEqual(Object.keys(where), ['whopId']);
    return tenants.get(where.whopId) ?? null;
  } } };
  const principal = await exports.verifyCustomerSession('signed-token-a', db, async (url, options) => {
    assert.equal(url, 'https://api.whop.com/oauth/userinfo');
    assert.equal(options.headers.authorization, 'Bearer signed-token-a');
    assert.equal(options.redirect, 'error');
    return { ok: true, text: async () => JSON.stringify({ sub: 'whop-tenant-a', email: 'b@example.invalid' }) };
  });
  assert.equal(principal.id, 'tenant-a');
  assert.equal(principal.email, 'a@example.invalid');
});

test('provider network failure and oversized tokens fail closed', async () => {
  const db = { user: { findUnique: () => { throw Error('Must not read'); } } };
  assert.equal(await exports.verifyCustomerSession('token', db, async () => { throw Error('Unavailable'); }), null);
  assert.equal(await exports.verifyCustomerSession('x'.repeat(4097), db), null);
});
