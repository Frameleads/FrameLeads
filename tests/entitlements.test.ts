import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corePaywallFeatureForName, FEATURE_KEYS, hasFeatureAccess, monthlyLeadQuotaForTier, requiredTierForFeature } from '../src/lib/entitlements';
import { localDevelopmentTierFor } from '../src/lib/local-development-tier';

test('local Enterprise tier applies only to development loopback hosts', () => {
  for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000']) {
    assert.equal(localDevelopmentTierFor(host, 'development'), 'ENTERPRISE');
    assert.equal(localDevelopmentTierFor(host, 'production'), null);
  }
  assert.equal(localDevelopmentTierFor('frameleads.com', 'development'), null);
  assert.equal(localDevelopmentTierFor(null, 'development'), null);
});

test('MICRO_PILOT includes inbox reading and replay while paid intelligence stays locked', () => {
  assert.equal(hasFeatureAccess('MICRO_PILOT', 'BASE_OUTBOUND'), true);
  assert.equal(hasFeatureAccess('MICRO_PILOT', 'BUILTIN_MARKET_MESSAGING'), true);
  assert.equal(hasFeatureAccess('MICRO_PILOT', 'INBOX_TRIAGE'), true);
  assert.equal(hasFeatureAccess('MICRO_PILOT', 'DECISION_REPLAY'), true);
  for (const feature of ['SCOUT', 'ICP', 'PROSPECT_RESEARCH', 'BRAIN', 'PLAYBOOK', 'CONSTITUTION_MANAGEMENT'] as const)
    assert.equal(hasFeatureAccess('MICRO_PILOT', feature), true, `${feature} is available with pilot limits`);
  for (const feature of FEATURE_KEYS.filter(key => !['BASE_OUTBOUND', 'BUILTIN_MARKET_MESSAGING', 'SCOUT', 'ICP', 'PROSPECT_RESEARCH', 'BRAIN', 'PLAYBOOK', 'INBOX_TRIAGE', 'DECISION_REPLAY', 'CONSTITUTION_MANAGEMENT'].includes(key))) {
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
  assert.equal(monthlyLeadQuotaForTier('ENTERPRISE'), 10_000);
  assert.equal(monthlyLeadQuotaForTier('ENTERPRISE', true), 20_000);
  assert.equal(monthlyLeadQuotaForTier('unknown'), 0);
});

test('Core paywall checks each named feature rather than borrowing the Scout entitlement', () => {
  assert.equal(corePaywallFeatureForName('Scout'), 'SCOUT');
  assert.equal(corePaywallFeatureForName('FrameLeads Brain'), 'BRAIN');
  assert.equal(corePaywallFeatureForName('Revenue Playbook'), 'PLAYBOOK');
  assert.equal(corePaywallFeatureForName('Inbox Triage'), 'INBOX_TRIAGE');
  assert.equal(corePaywallFeatureForName('Decision Replay'), 'DECISION_REPLAY');
  assert.equal(corePaywallFeatureForName('Prospect Memory'), 'PROSPECT_MEMORY');
  assert.equal(hasFeatureAccess('MICRO_PILOT', corePaywallFeatureForName('Prospect Memory')), false);
});

test('upgrade transitions expand entitlements and a return to Micro-Pilot restores only its explicit allowlist', () => {
  assert.equal(hasFeatureAccess('MICRO_PILOT', 'SCOUT'), true);
  assert.equal(hasFeatureAccess('CORE', 'PROSPECT_MEMORY'), true);
  assert.equal(hasFeatureAccess('ENTERPRISE', 'AUTOMATION'), true);
  assert.equal(hasFeatureAccess('MICRO_PILOT', 'PROSPECT_MEMORY'), false);
  assert.equal(hasFeatureAccess('MICRO_PILOT', 'AUTOMATION'), false);
});
