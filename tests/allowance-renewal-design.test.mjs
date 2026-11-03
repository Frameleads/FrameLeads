import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
// Use the actual entitlement and cache implementation without loading Next/DB.
function loadTS(file) {
  const code = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  // These modules' only runtime dependency is the small membership error module.
  new Function('module', 'exports', 'require', code)(module, module.exports, path => {
    if (path === './whop-subscription') return loadTS('../src/lib/whop-subscription.ts');
    if (path === './entitlements') return loadTS('../src/lib/entitlements.ts');
    if (path === './whop-environment') return { isWhopSandbox: () => false };
    throw new Error('Unexpected test dependency: ' + path);
  });
  return module.exports;
}
const { monthlyLeadQuotaForTier } = loadTS('../src/lib/entitlements.ts');
const { createWhopEntitlementRefresher } = loadTS('../src/lib/whop-entitlement-refresh.ts');
const { transition } = require('../docs/allowance-renewal/reference-policy.cjs');
const first = { verified: true, monthlyCadenceConfirmed: true, companyId: 'company-fixture', subjectId: 'buyer-fixture', membershipId: 'member-fixture', start: 100, end: 200 };
const second = { ...first, start: 200, end: 300 };
const op = (id, count = 1) => ({ id, count, hash: 'stable-payload-' + id });
function apply(overrides = {}) {
  return transition({ current: null, period: first, tier: 'ENTERPRISE', now: 150, legacyUsage: 0, operation: op('new'), cap: monthlyLeadQuotaForTier('ENTERPRISE'), ...overrides });
}

for (const tier of ['CORE', 'ENTERPRISE']) test(`characterization: actual ${tier} entitlement refresh at renewal does not replenish consumption`, async () => {
  const cap = monthlyLeadQuotaForTier(tier);
  let now = 150, verifies = 0;
  const account = { tier, monthlyQuota: cap, leadsProcessed: cap };
  const refresh = createWhopEntitlementRefresher({ now: () => now,
    verify: async () => { verifies++; return { tier, monthlyQuota: cap, validUntil: now < 200 ? 200 : 300 }; },
    persist: async (_id, data) => Object.assign(account, data),
  });
  const input = { userId: 'fixture', whopUserId: 'buyer-fixture', accessToken: 'not-a-real-token', currentTier: tier, currentMonthlyQuota: cap };
  assert.equal(await refresh.refresh(input), tier);
  now = 200;
  assert.equal(await refresh.refresh(input), tier);
  assert.equal(verifies, 2);
  assert.equal(account.leadsProcessed, cap); // Observed defect, not desired behavior.
});
for (const [tier, cap] of [['CORE', 500], ['ENTERPRISE', 10000]]) {
  test(`design: ${tier} final slot is valid and next operation is exhausted`, () => {
    const r = apply({ tier, cap, legacyUsage: cap - 1, operation: op('last', 2) });
    assert.equal(r.allocated, 1);
    assert.equal(apply({ tier, cap, current: r.state, operation: op('excess') }).allocated, 0);
  });
  test(`design: ${tier} boundary opens exactly one fresh period and retains old history`, () => {
    const current = { ...first, used: cap };
    const r = apply({ tier, cap, current, period: second, now: 200 });
    assert.deepEqual(current, { ...first, used: cap });
    assert.deepEqual(r.archive, current);
    assert.equal(r.state.used, 1);
    const again = apply({ tier, cap, current: r.state, period: second, now: 201, receipt: r.receipt });
    assert.equal(again.replay, true);
    assert.equal(again.lifetimeIncrement, 0);
  });
}
test('design: legacy usage 15000 is retained with zero allocation at cutover', () => {
  const r = apply({ legacyUsage: 15000 });
  assert.equal(r.state.used, 15000); assert.equal(r.allocated, 0);
});
test('design: cross-period duplicate is replayed and never charges the new bucket', () => {
  const r = apply();
  const replay = apply({ current: r.state, period: second, now: 200, receipt: r.receipt });
  assert.equal(replay.replay, true); assert.equal(replay.state.used, 1);
  assert.equal(replay.lifetimeIncrement, 0);
  const next = apply({ current: replay.state, period: second, now: 200, operation: op('different') });
  assert.equal(next.state.used, 1); assert.equal(next.archive.used, 1);
});
test('design: changed idempotency payload conflicts', () => {
  const r = apply();
  assert.throws(() => apply({ receipt: r.receipt, operation: { ...op('new'), hash: 'other' } }), /IDEMPOTENCY_CONFLICT/);
});
test('design: expired, future, unverified and unknown cadence periods fail closed', () => {
  for (const patch of [{ end: 150 }, { start: 151 }, { verified: false }, { monthlyCadenceConfirmed: false }, { start: NaN }])
    assert.throws(() => apply({ period: { ...first, ...patch } }), /PERIOD_REQUIRED/);
});
test('design: stale and overlapping periods, same-start extensions and membership swaps cannot reset usage', () => {
  const current = { ...second, used: 500 };
  for (const period of [first, { ...second, start: 190 }, { ...second, end: 350 }, { ...second, membershipId: 'other' }])
    assert.throws(() => apply({ current, period, now: 250 }), /REQUIRED/);
});
test('design: tenant or company changes are rejected', () => {
  for (const key of ['companyId', 'subjectId'])
    assert.throws(() => apply({ current: { ...first, used: 0 }, period: { ...first, [key]: 'other' } }), /PRINCIPAL_CHANGED/);
});
test('design: Core to Enterprise and back in the same period carries consumption', () => {
  const current = { ...first, used: 700 };
  assert.equal(apply({ current, tier: 'CORE', cap: monthlyLeadQuotaForTier('CORE') }).allocated, 0);
  assert.equal(apply({ current }).state.used, 701);
});
test('design: Micro-Pilot and inactive accounts never enter recurring allowance logic', () => {
  for (const tier of ['MICRO_PILOT', 'INACTIVE']) assert.throws(() => apply({ tier }), /RECURRING_TIER_REQUIRED/);
});
test('design: serialized transaction model cannot overspend one final slot', async () => {
  // Tests the state machine under the specified lock contract; not a live SQL test.
  let state = { ...first, used: 9999 }, tail = Promise.resolve();
  const allocate = (id) => {
    const run = tail.then(() => { const r = apply({ current: state, operation: op(id) }); state = r.state; return r.allocated; });
    tail = run.then(() => undefined); return run;
  };
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => allocate('request-' + i)));
  assert.equal(results.reduce((a, b) => a + b, 0), 1); assert.equal(state.used, 10000);
});
