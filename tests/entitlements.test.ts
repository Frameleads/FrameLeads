import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS, hasFeatureAccess, monthlyLeadQuotaForTier, requiredTierForFeature } from '../src/lib/entitlements';

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
