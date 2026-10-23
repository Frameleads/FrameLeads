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


test('Sandbox Core membership readback demands exact company, paid receipt, session and logged-in Whop subject', async () => {
  const { reviewSandboxCoreMembershipEvidence } = await import('../src/lib/whop-sandbox-core-access-review');
  const env = {
    FRAMELEADS_SANDBOX_CORE_MEMBERSHIP_REVIEW_ENABLED: 'true',
    VERCEL_ENV: 'preview', WHOP_ENVIRONMENT: 'sandbox',
    WHOP_SANDBOX_ACCOUNT_ID: 'biz_6YudF3G7nc8Wdw',
    WHOP_SANDBOX_PRODUCT_ID: 'prod_2RDEl6d8jhM9W',
    WHOP_SANDBOX_CORE_PLAN_ID: 'plan_kgrX8LpuAH2Ba',
    WHOP_COMPANY_ID: 'biz_RSQW7xARXYAQke',
  };
  const buyer = 'user_SandboxBuyer123';
  const receipt = {
    environment: 'sandbox' as const, state: 'PROCESSED' as const, linkage: 'LINKED' as const,
    paymentId: 'pay_SandboxPurchase123', membershipId: 'mem_SandboxMember123',
    checkoutConfigurationId: 'ch_SandboxCheckout123',
    directAttemptId: '11111111-1111-4111-8111-111111111111',
    accountId: env.WHOP_SANDBOX_ACCOUNT_ID, productId: env.WHOP_SANDBOX_PRODUCT_ID,
    planId: env.WHOP_SANDBOX_CORE_PLAN_ID,
  };
  const membership = {
    id: receipt.membershipId, checkout_configuration_id: receipt.checkoutConfigurationId,
    company: { id: receipt.accountId },
    plan: { id: receipt.planId, title: 'Enterprise-looking text must not upgrade tier' },
    product: { id: receipt.productId, title: 'Unknown name' },
    user: { id: buyer, email: 'different@example.com' },
    status: 'active', currency: 'usd',
    metadata: {
      frameleads_direct_checkout_attempt_id: receipt.directAttemptId,
      affiliate_verification: 'NO_AFFILIATE',
    },
  };

  const result = reviewSandboxCoreMembershipEvidence(env, buyer, receipt, membership);
  assert.deepEqual(result, { status: 'EVIDENCE_MATCHED', tier: 'CORE', monthlyQuota: 500 });
  assert.deepEqual(reviewSandboxCoreMembershipEvidence(
    { ...env, FRAMELEADS_SANDBOX_CORE_MEMBERSHIP_REVIEW_ENABLED: undefined },
    buyer, receipt, membership,
  ), { status: 'DISABLED' });
  assert.deepEqual(reviewSandboxCoreMembershipEvidence(
    { ...env, VERCEL_ENV: 'production' }, buyer, receipt, membership,
  ), { status: 'DISABLED' });
  assert.deepEqual(reviewSandboxCoreMembershipEvidence(
    { ...env, WHOP_SANDBOX_ACCOUNT_ID: env.WHOP_COMPANY_ID }, buyer, receipt, membership,
  ), { status: 'DISABLED' });

  for (const patch of [
    { environment: 'production' as const },
    { state: 'REVIEW_REQUIRED' as const },
    { linkage: 'UNLINKED' as const },
    { paymentId: 'not-provider-id' },
    { membershipId: 'mem_Other' },
    { checkoutConfigurationId: 'ch_Other' },
    { directAttemptId: 'invalid-uuid' },
    { accountId: env.WHOP_COMPANY_ID }, { productId: 'prod_Other' },
    { planId: 'plan_sAEhr77rTrhX4' },
  ]) {
    assert.deepEqual(reviewSandboxCoreMembershipEvidence(
      env, buyer, { ...receipt, ...patch }, membership,
    ), { status: 'REVIEW_REQUIRED' }, JSON.stringify(patch));
  }
  for (const patch of [
    { id: 'mem_Other' }, { checkout_configuration_id: 'ch_Other' },
    { company: { id: env.WHOP_COMPANY_ID } },
    { plan: { id: 'plan_jdy5Z44fMKMAz', title: 'Core' } },
    { product: { id: 'prod_Other', title: 'Core' } },
    { user: { id: 'user_Other', email: 'different@example.com' } },
    { status: 'past_due' }, { status: 'trialing' }, { status: 'canceled' },
    { currency: 'aed' },
    { metadata: { ...membership.metadata, frameleads_checkout_attempt_id: receipt.directAttemptId } },
    { metadata: { ...membership.metadata, affiliate_code: 'PARTNER' } },
    { metadata: { ...membership.metadata, frameleads_direct_checkout_attempt_id: '22222222-2222-4222-8222-222222222222' } },
  ]) {
    assert.deepEqual(reviewSandboxCoreMembershipEvidence(
      env, buyer, receipt, { ...membership, ...patch },
    ), { status: 'REVIEW_REQUIRED' }, JSON.stringify(patch));
  }
  assert.deepEqual(reviewSandboxCoreMembershipEvidence(
    env, 'user_Attacker', receipt, membership,
  ), { status: 'REVIEW_REQUIRED' });
  assert.deepEqual(reviewSandboxCoreMembershipEvidence(
    env, buyer, receipt, null,
  ), { status: 'REVIEW_REQUIRED' });
});


test('Sandbox Core lifecycle review refuses stale, disputed, refunded, or unrelated payment evidence', async () => {
  const { reviewSandboxCorePaymentLifecycleForE2E } =
    await import('../src/lib/whop-sandbox-core-lifecycle-review');
  const env = {
    FRAMELEADS_SANDBOX_CORE_MEMBERSHIP_REVIEW_ENABLED: 'true',
    VERCEL_ENV: 'preview', WHOP_ENVIRONMENT: 'sandbox',
    WHOP_SANDBOX_ACCOUNT_ID: 'biz_6YudF3G7nc8Wdw',
    WHOP_SANDBOX_PRODUCT_ID: 'prod_2RDEl6d8jhM9W',
    WHOP_SANDBOX_CORE_PLAN_ID: 'plan_kgrX8LpuAH2Ba',
    WHOP_COMPANY_ID: 'biz_NotSandbox',
  };
  const id='user_Buyer0001';
  const receipt = {
    environment: 'sandbox' as const, state: 'PROCESSED' as const,
    linkage: 'LINKED' as const,
    paymentId: 'pay_Initial0001', membershipId: 'mem_Buyer0001',
    checkoutConfigurationId: 'ch_Checkout0001',
    directAttemptId: '11111111-1111-4111-8111-111111111111',
    accountId: env.WHOP_SANDBOX_ACCOUNT_ID, planId: env.WHOP_SANDBOX_CORE_PLAN_ID,
    productId: env.WHOP_SANDBOX_PRODUCT_ID,
  };
  const membership = {
    id: receipt.membershipId, checkout_configuration_id: receipt.checkoutConfigurationId,
    company: { id: receipt.accountId }, plan: { id: receipt.planId },
    product: { id: receipt.productId }, user: { id },
    status: 'active', currency: 'usd',
    metadata: {
      frameleads_direct_checkout_attempt_id: receipt.directAttemptId,
      affiliate_verification: 'NO_AFFILIATE',
    },
  };
  const now=1800000000;
  const paid = {
    source: 'AUTHENTICATED_WHOP_READBACK' as const, paymentId: 'pay_Renewal0001',
    membershipId: receipt.membershipId, accountId: receipt.accountId,
    productId: receipt.productId, planId: receipt.planId,
    status: 'PAID' as const, adversePaymentSignal: false,
    checkedAtEpochSeconds: now - 5,
  };
  const call=(payment=paid, m=membership, when=now)=>
    reviewSandboxCorePaymentLifecycleForE2E(env,id,receipt,m,payment,when);
  assert.deepEqual(call(), {status:'EVIDENCE_MATCHED_FOR_E2E'});
  for (const status of ['PENDING','FAILED','REFUNDED','DISPUTED','CHARGEBACK','UNKNOWN'] as const)
    assert.deepEqual(call({...paid,status}), {status:'REVIEW_REQUIRED'});
  for (const bad of [
    {...paid,adversePaymentSignal:true},
    {...paid,source:'BROWSER_CALLBACK' as const},
    {...paid,membershipId:'mem_Attacker0001'},
    {...paid,accountId:'biz_Wrong0001'},
    {...paid,planId:'plan_Wrong0001'},
    {...paid,productId:'prod_Wrong0001'},
    {...paid,checkedAtEpochSeconds:now-301},
    {...paid,checkedAtEpochSeconds:now+31},
  ]) assert.deepEqual(call(bad),{status:'REVIEW_REQUIRED'});
  for (const badMembership of [
    {...membership,status:'canceled'},
    {...membership,status:'past_due'},
    {...membership,user:{id:'user_Another0001'}},
  ]) assert.deepEqual(call(paid,badMembership),{status:'REVIEW_REQUIRED'});
  assert.deepEqual(call(null),{status:'REVIEW_REQUIRED'});
  assert.deepEqual(reviewSandboxCorePaymentLifecycleForE2E(
    {...env,VERCEL_ENV:'production'},id,receipt,membership,paid,now
  ),{status:'DISABLED'});
});
