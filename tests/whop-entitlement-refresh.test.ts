import { verifyCustomerSession } from '../src/lib/customer-session';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWhopEntitlementRefresher } from '../src/lib/whop-entitlement-refresh';
import { MembershipFilteredOutError, type WhopSubscription } from '../src/lib/whop-subscription';

const active: WhopSubscription = { tier: 'CORE', monthlyQuota: 500, validUntil: 90_000 };

function input(currentTier = 'INACTIVE') {
  return { userId: 'user_row', whopUserId: 'user_whop', accessToken: 'synthetic-oauth-token', currentTier, currentMonthlyQuota: 0 };
}

test('paid feature freshness checks cache briefly and refresh to the current provider tier', async () => {
  let clock = 0;
  let checks = 0;
  const persisted: Array<{ tier: string; monthlyQuota: number }> = [];
  let provider: () => Promise<WhopSubscription> = async () => active;
  const refresher = createWhopEntitlementRefresher({
    now: () => clock,
    verify: async () => { checks++; return provider(); },
    persist: async (_id, row) => { persisted.push(row); },
  });
  assert.equal(await refresher.refresh(input()), 'CORE');
  assert.equal(checks, 1);
  assert.deepEqual(persisted, [{ tier: 'CORE', monthlyQuota: 500 }]);
  clock = 20_000;
  assert.equal(await refresher.refresh(input('CORE')), 'CORE');
  assert.equal(checks, 1, 'fresh response is reused for at most the short cache interval');
  clock = 31_000;
  provider = async () => ({ tier: 'ENTERPRISE', monthlyQuota: 20_000 });
  assert.equal(await refresher.refresh(input('CORE')), 'ENTERPRISE');
  assert.equal(checks, 2);
});

test('only marked legacy Enterprise accounts retain 20k on verified refresh; downgrade loses Enterprise quota', async () => {
  const persisted: Array<{ tier: string; monthlyQuota: number }> = [];
  let provider: WhopSubscription = { tier: 'ENTERPRISE', monthlyQuota: 10_000 };
  const refresher = createWhopEntitlementRefresher({
    verify: async () => provider,
    persist: async (_id, ent) => { persisted.push(ent); },
  });
  const oldBuyer = { ...input(), whopUserId: 'old_enterprise', enterpriseLegacyQuota: true };
  const newBuyer = { ...input(), whopUserId: 'new_enterprise', enterpriseLegacyQuota: false };
  assert.equal(await refresher.refresh(oldBuyer), 'ENTERPRISE');
  assert.deepEqual(persisted.at(-1), { tier: 'ENTERPRISE', monthlyQuota: 20_000 });
  assert.equal(await refresher.refresh(newBuyer), 'ENTERPRISE');
  assert.deepEqual(persisted.at(-1), { tier: 'ENTERPRISE', monthlyQuota: 10_000 });
  refresher.invalidate('old_enterprise');
  provider = { tier: 'CORE', monthlyQuota: 500 };
  assert.equal(await refresher.refresh({ ...oldBuyer, currentTier: 'ENTERPRISE', currentMonthlyQuota: 20_000 }), 'CORE');
  assert.deepEqual(persisted.at(-1), { tier: 'CORE', monthlyQuota: 500 });
});

test('provider outage uses only recent verified access and never crosses a known renewal boundary', async () => {
  let clock = 0;
  let offline = false;
  const refresher = createWhopEntitlementRefresher({
    now: () => clock,
    verify: async () => { if (offline) throw new Error('provider unavailable'); return active; },
    persist: async () => {},
  });
  assert.equal(await refresher.refresh(input()), 'CORE');
  clock = 31_000;
  offline = true;
  assert.equal(await refresher.refresh(input('CORE')), 'CORE', 'brief outage grace preserves a recently verified buyer');
  clock = 90_000;
  assert.equal(await refresher.refresh(input('CORE')), 'INACTIVE', 'stale access cannot cross the last known billing-period end');
  const cold = createWhopEntitlementRefresher({
    now: () => 0,
    verify: async () => { throw new Error('provider unavailable'); },
    persist: async () => {},
  });
  assert.equal(await cold.refresh(input('CORE')), 'INACTIVE', 'a cold process fails closed when Whop cannot verify');
});

test('authoritative no-membership and unknown-plan results revoke stale tier, while webhook invalidation forces a read', async () => {
  let clock = 0;
  let checks = 0;
  let inactive = false;
  const persisted: Array<{ tier: string; monthlyQuota: number }> = [];
  const refresher = createWhopEntitlementRefresher({
    now: () => clock,
    verify: async () => {
      checks++;
      if (inactive) throw new MembershipFilteredOutError(1);
      return active;
    },
    persist: async (_id, row) => { persisted.push(row); },
  });
  assert.equal(await refresher.refresh(input()), 'CORE');
  refresher.invalidate('user_whop');
  inactive = true;
  assert.equal(await refresher.refresh(input('CORE')), 'INACTIVE');
  assert.equal(checks, 2);
  assert.deepEqual(persisted.at(-1), { tier: 'INACTIVE', monthlyQuota: 0 });
});


test('transient Whop userinfo failure retries without authenticating an unverified user', async () => {
  let attempts = 0;
  const db: any = { user: { findUnique: async ({ where }: any) => where.whopId === 'whop-test-1'
    ? { id: 'tenant-1', tier: 'MICRO_PILOT', whopId: 'whop-test-1', email: 'demo@example.test' } : null } };
  const request = (async () => {
    attempts++;
    return attempts === 1 ? new Response('', { status: 503 }) :
      new Response(JSON.stringify({ sub: 'whop-test-1', email: 'demo@example.test' }), {status: 200});
  }) as typeof fetch;
  const user = await verifyCustomerSession('valid-oauth-test-token', db, request);
  assert.equal(user?.id, 'tenant-1');
  assert.equal(attempts, 2);
});

test('Whop identity 401 never retries, never trusts email, and never grants access', async () => {
  let attempts = 0, queries = 0;
  const db: any = { user: { findUnique: async () => {queries++;return { id: 'should-not-happen' };} } };
  const request = (async () => {attempts++;return new Response('', {status:401});}) as typeof fetch;
  assert.equal(await verifyCustomerSession('invalid-oauth-token',db,request),null);
  assert.equal(attempts,1);
  assert.equal(queries,0);
});

test('network verification failure does not create a customer session', async () => {
  let attempts = 0;
  const db: any = { user: { findUnique: async () => {throw Error('Must not query tenant');} } };
  const request = (async () => {attempts++;throw new Error('temporary upstream network error');}) as typeof fetch;
  assert.equal(await verifyCustomerSession('opaque-token',db,request),null);
  assert.equal(attempts,2);
});
