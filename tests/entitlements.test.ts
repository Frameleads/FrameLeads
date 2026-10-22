import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS, hasFeatureAccess, monthlyLeadQuotaForTier, requiredTierForFeature } from '../src/lib/entitlements';
import { localDevelopmentTierFor } from '../src/lib/local-development-tier';

test('local Enterprise tier applies only to development loopback hosts', () => {
  for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000']) {
    assert.equal(localDevelopmentTierFor(host, 'development'), 'ENTERPRISE');
    assert.equal(localDevelopmentTierFor(host, 'production'), null);
  }
  assert.equal(localDevelopmentTierFor('frameleads.com', 'development'), null);
  assert.equal(localDevelopmentTierFor(null, 'development'), null);
});

test('MICRO_PILOT includes only the base outbound and built-in market capabilities', () => {
  assert.equal(hasFeatureAccess('MICRO_PILOT', 'BASE_OUTBOUND'), true);
  assert.equal(hasFeatureAccess('MICRO_PILOT', 'BUILTIN_MARKET_MESSAGING'), true);
  for (const feature of FEATURE_KEYS.filter(key => !['BASE_OUTBOUND', 'BUILTIN_MARKET_MESSAGING'].includes(key))) {
    assert.equal(hasFeatureAccess('MICRO_PILOT', feature), false, `${feature} should be locked`);
    assert.ok(['CORE', 'ENTERPRISE'].includes(requiredTierForFeature(feature)));
  }
});

test('CORE inherits Core features and outcome capture but not Enterprise capabilities', () => {
  for (const feature of ['BASE_OUTBOUND', 'BUILTIN_MARKET_MESSAGING', 'SCOUT', 'ICP', 'PROSPECT_RESEARCH',
    'PROSPECT_MEMORY', 'BRAIN', 'PLAYBOOK', 'INBOX_TRIAGE', 'DECISION_ENGINE', 'DECISION_REPLAY', 'OUTCOME_CAPTURE'] as const)
    assert.equal(hasFeatureAccess('CORE', feature), true, `${feature} should be available`);
  for (const feature of ['CUSTOM_MARKET_PROFILES', 'GOVERNANCE', 'CONSTITUTION_MANAGEMENT', 'AUTOMATION',
    'REVENUE_RISK', 'RESPONSE_SLA', 'DECISION_SANDBOX', 'OUTCOME_LEARNING'] as const) {
    assert.equal(hasFeatureAccess('CORE', feature), false, `${feature} should be locked`);
    assert.equal(requiredTierForFeature(feature), 'ENTERPRISE');
  }
});

test('ENTERPRISE inherits all capabilities; inactive and unknown tiers fail closed', () => {
  for (const feature of FEATURE_KEYS) assert.equal(hasFeatureAccess('ENTERPRISE', feature), true, feature);
  for (const tier of ['INACTIVE', null, undefined, '', 'UNEXPECTED'])
    for (const feature of FEATURE_KEYS) assert.equal(hasFeatureAccess(tier, feature), false);
});

test('tier quota values remain locked', () => {
  assert.equal(monthlyLeadQuotaForTier('MICRO_PILOT'), 25);
  assert.equal(monthlyLeadQuotaForTier('CORE'), 500);
  assert.equal(monthlyLeadQuotaForTier('ENTERPRISE'), 20_000);
  assert.equal(monthlyLeadQuotaForTier('unknown'), 0);
});


test('current paid Core and Enterprise plan IDs resolve without trusting product names', async () => {
  const { resolveWhopSubscription } = await import('../src/lib/whop-subscription');
  const previousCore = process.env.WHOP_CORE_IDS;
  const previousEnterprise = process.env.WHOP_ENTERPRISE_IDS;
  const previousCorePattern = process.env.WHOP_CORE_PATTERN;
  const previousEnterprisePattern = process.env.WHOP_ENTERPRISE_PATTERN;
  try {
    delete process.env.WHOP_CORE_IDS;
    delete process.env.WHOP_ENTERPRISE_IDS;
    delete process.env.WHOP_CORE_PATTERN;
    delete process.env.WHOP_ENTERPRISE_PATTERN;
    for (const [planId, expectedTier, expectedQuota] of [
      ['plan_sAEhr77rTrhX4', 'CORE', 500],
      ['plan_jdy5Z44fMKMAz', 'ENTERPRISE', 20_000],
      ['plan_MUeh0CYdRPPaJ', 'CORE', 500],
      ['plan_PZqjKqvMr0KBI', 'ENTERPRISE', 20_000],
    ] as const) {
      const mapped = resolveWhopSubscription({
        product: { id: 'prod_unrecognized', name: 'Unnamed' },
        plan: { id: planId, name: 'Unnamed' },
      });
      assert.equal(mapped.tier, expectedTier, planId);
      assert.equal(mapped.monthlyQuota, expectedQuota, planId);
    }
    assert.throws(() => resolveWhopSubscription({
      product: { id: 'prod_unrecognized' },
      plan: { id: 'plan_unrecognized' },
    }), /Unrecognized Whop product/);
  } finally {
    if (previousCore === undefined) delete process.env.WHOP_CORE_IDS;
    else process.env.WHOP_CORE_IDS = previousCore;
    if (previousEnterprise === undefined) delete process.env.WHOP_ENTERPRISE_IDS;
    else process.env.WHOP_ENTERPRISE_IDS = previousEnterprise;
    if (previousCorePattern === undefined) delete process.env.WHOP_CORE_PATTERN;
    else process.env.WHOP_CORE_PATTERN = previousCorePattern;
    if (previousEnterprisePattern === undefined) delete process.env.WHOP_ENTERPRISE_PATTERN;
    else process.env.WHOP_ENTERPRISE_PATTERN = previousEnterprisePattern;
  }
});

test('environment override remains authoritative and needs release verification', async () => {
  const { resolveWhopSubscription } = await import('../src/lib/whop-subscription');
  const before = process.env.WHOP_CORE_IDS;
  const patternBefore = process.env.WHOP_CORE_PATTERN;
  try {
    process.env.WHOP_CORE_IDS = 'plan_sandbox_isolated';
    process.env.WHOP_CORE_PATTERN = 'NEVER_MATCH_WHOP_CHECKOUT_CONTRACT';
    assert.throws(() => resolveWhopSubscription({ plan: { id: 'plan_sAEhr77rTrhX4' } }), /Unrecognized Whop product/);
    assert.equal(resolveWhopSubscription({ plan: { id: 'plan_sandbox_isolated' } }).tier, 'CORE');
  } finally {
    if (before === undefined) delete process.env.WHOP_CORE_IDS;
    else process.env.WHOP_CORE_IDS = before;
    if (patternBefore === undefined) delete process.env.WHOP_CORE_PATTERN;
    else process.env.WHOP_CORE_PATTERN = patternBefore;
  }
});
