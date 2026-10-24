import assert from 'node:assert/strict';
import { test } from 'node:test';
import { membershipCurrentlyEntitled, verifyWhopSubscription } from '../src/lib/whop-memberships';
import { resolveWhopSubscription } from '../src/lib/whop-subscription';

const now = Date.parse('2026-10-25T12:00:00.000Z');
const future = '2026-11-25T12:00:00.000Z';
const past = '2026-10-24T12:00:00.000Z';

function membership(status: string, extra: Record<string, unknown> = {}) {
  return { id: 'mem_test', status, user_id: 'user_test', company: { id: 'biz_test' }, ...extra };
}

test('Whop membership lifecycle grants only current paid/trial access and scheduled cancellation through term end', () => {
  assert.equal(membershipCurrentlyEntitled(membership('active'), now), true);
  assert.equal(membershipCurrentlyEntitled(membership('active', { cancel_at_period_end: true, renewal_period_end: future }), now), true);
  assert.equal(membershipCurrentlyEntitled(membership('canceling', { cancel_at_period_end: true, renewal_period_end: future }), now), true);
  assert.equal(membershipCurrentlyEntitled(membership('canceling', { renewal_period_end: future }), now), false);
  assert.equal(membershipCurrentlyEntitled(membership('active', { cancel_at_period_end: true, renewal_period_end: past }), now), false);
  assert.equal(membershipCurrentlyEntitled(membership('active', { renewal_period_end: past }), now), false);
  assert.equal(membershipCurrentlyEntitled(membership('trialing', { renewal_period_end: future }), now), true);
  assert.equal(membershipCurrentlyEntitled(membership('trialing', { renewal_period_end: past }), now), false);
  for (const status of ['canceled', 'expired', 'past_due', 'unresolved', 'drafted', 'unknown']) {
    assert.equal(membershipCurrentlyEntitled(membership(status), now), false, status);
  }
  assert.equal(membershipCurrentlyEntitled(membership('active', { valid: false }), now), false);
  assert.equal(membershipCurrentlyEntitled(membership('completed'), now), true, 'retain recognized legacy one-time memberships');
  assert.equal(membershipCurrentlyEntitled(membership('completed', { expires_at: past }), now), false);
});

test('existing SaaS maps the checkout Core and Enterprise plan IDs to their paid tiers', () => {
  assert.deepEqual(resolveWhopSubscription({ plan: { id: 'plan_sAEhr77rTrhX4' } }), { tier: 'CORE', monthlyQuota: 500 });
  assert.deepEqual(resolveWhopSubscription({ plan: { id: 'plan_jdy5Z44fMKMAz' } }), { tier: 'ENTERPRISE', monthlyQuota: 20_000 });
  assert.deepEqual(resolveWhopSubscription({ plan: { id: 'plan_8qLWfJZHQUYZf' } }), { tier: 'MICRO_PILOT', monthlyQuota: 25 });
  assert.deepEqual(resolveWhopSubscription({ product: { id: 'prod_bTf6npFBh6teM' } }), { tier: 'MICRO_PILOT', monthlyQuota: 25 });
});

test('membership verification follows bounded Whop cursors and selects the highest current membership for the exact buyer/company', async () => {
  const previousCompany = process.env.WHOP_COMPANY_ID;
  process.env.WHOP_COMPANY_ID = 'biz_test';
  const requests: URL[] = [];
  const first = [
    membership('active', { user_id: 'user_other', plan: { id: 'plan_jdy5Z44fMKMAz' } }),
    membership('canceled', { plan: { id: 'plan_jdy5Z44fMKMAz' }, renewal_period_end: future }),
    membership('active', { plan: { id: 'plan_sAEhr77rTrhX4' }, renewal_period_end: '2030-01-01T00:00:00.000Z' }),
  ];
  const second = [membership('canceling', { plan: { id: 'plan_jdy5Z44fMKMAz' }, cancel_at_period_end: true, renewal_period_end: '2031-01-01T00:00:00.000Z' })];
  try {
    const result = await verifyWhopSubscription('synthetic-token', 'user_test', async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-token');
      return new Response(JSON.stringify(requests.length === 1
        ? { data: first, page_info: { has_next_page: true, end_cursor: 'cursor_one' } }
        : { data: second, page_info: { has_next_page: false, end_cursor: null } }), { status: 200 });
    });
    assert.equal(result.tier, 'ENTERPRISE');
    assert.equal(result.monthlyQuota, 20_000);
    assert.equal(result.validUntil, Date.parse('2030-01-01T00:00:00.000Z'));
    assert.equal(requests.length, 2);
    assert.equal(requests[0].searchParams.get('account_id'), 'biz_test');
    assert.equal(requests[0].searchParams.get('user_id'), 'me');
    assert.equal(requests[0].searchParams.get('first'), '50');
    assert.equal(requests[1].searchParams.get('after'), 'cursor_one');
  } finally {
    if (previousCompany === undefined) delete process.env.WHOP_COMPANY_ID;
    else process.env.WHOP_COMPANY_ID = previousCompany;
  }
});

test('membership verification fails closed for wrong company, past_due, unknown plan, and incomplete pagination', async () => {
  const previousCompany = process.env.WHOP_COMPANY_ID;
  process.env.WHOP_COMPANY_ID = 'biz_test';
  const reply = (data: unknown[], page_info = { has_next_page: false, end_cursor: null }) => new Response(JSON.stringify({ data, page_info }), { status: 200 });
  try {
    await assert.rejects(verifyWhopSubscription('token', 'user_test', async () => reply([
      membership('active', { company: { id: 'biz_other' }, plan: { id: 'plan_sAEhr77rTrhX4' } }),
      membership('past_due', { plan: { id: 'plan_sAEhr77rTrhX4' } }),
    ])), /Membership filtered out/);
    await assert.rejects(verifyWhopSubscription('token', 'user_test', async () => reply([
      membership('active', { plan: { id: 'plan_new_unknown' }, product: { id: 'prod_new_unknown', name: 'new product' } }),
    ])), /Unrecognized Whop product/);
    await assert.rejects(verifyWhopSubscription('token', 'user_test', async () => reply([
      membership('active', { plan: { id: 'plan_sAEhr77rTrhX4' } }),
    ], { has_next_page: true, end_cursor: null })), /pagination was incomplete/);
  } finally {
    if (previousCompany === undefined) delete process.env.WHOP_COMPANY_ID;
    else process.env.WHOP_COMPANY_ID = previousCompany;
  }
});
