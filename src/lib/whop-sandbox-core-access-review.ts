/**
 * Review-only evidence gate for a genuine Whop Sandbox Core checkout.
 *
 * NOT imported by production authentication, plan mapping or webhook routes.
 * NOT an entitlement grant. The result only specifies what a protected
 * Sandbox preview must prove before a SaaS access E2E test can be accepted.
 *
 * Inputs must come from (1) a verified authenticated Whop OAuth subject,
 * (2) the separately committed, reconciled direct-purchase receipt, and
 * (3) an authenticated Whop Membership API read-back.
 *
 * Do not trust buyer email, checkout return URL, plan names or client flags.
 * Docs: https://docs.whop.com/api-reference/memberships/membership
 */
export type SandboxCoreAccessReviewEnv = Record<string, string | undefined>;

export interface SandboxCoreVerifiedReceipt {
  environment: 'sandbox' | 'production';
  state: 'PROCESSED' | 'REVIEW_REQUIRED';
  linkage: 'LINKED' | 'UNLINKED';
  paymentId: string;
  membershipId: string;
  checkoutConfigurationId: string;
  directAttemptId: string;
  accountId: string;
  productId: string;
  planId: string;
}

const record = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const id = (x: unknown, prefix: string): x is string =>
  typeof x === 'string' && new RegExp('^' + prefix + '_[A-Za-z0-9]{3,120}$').test(x);
const uuid = (x: unknown): x is string =>
  typeof x === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);

const SANDBOX = {
  company: 'biz_6YudF3G7nc8Wdw',
  plan: 'plan_kgrX8LpuAH2Ba',
  product: 'prod_2RDEl6d8jhM9W',
};

export type SandboxCoreAccessReview =
  | { status: 'DISABLED' | 'REVIEW_REQUIRED' }
  | { status: 'EVIDENCE_MATCHED'; tier: 'CORE'; monthlyQuota: 500 };

export function reviewSandboxCoreMembershipEvidence(
  env: SandboxCoreAccessReviewEnv,
  authenticatedWhopUserId: string,
  receipt: SandboxCoreVerifiedReceipt | null,
  authenticatedMembershipReadback: unknown,
): SandboxCoreAccessReview {
  if (env.FRAMELEADS_SANDBOX_CORE_MEMBERSHIP_REVIEW_ENABLED !== 'true'
    || env.VERCEL_ENV !== 'preview'
    || env.WHOP_ENVIRONMENT !== 'sandbox'
    || env.WHOP_SANDBOX_ACCOUNT_ID !== SANDBOX.company
    || env.WHOP_SANDBOX_CORE_PLAN_ID !== SANDBOX.plan
    || env.WHOP_SANDBOX_PRODUCT_ID !== SANDBOX.product
    || env.WHOP_SANDBOX_ACCOUNT_ID === env.WHOP_COMPANY_ID) return { status: 'DISABLED' };

  if (!id(authenticatedWhopUserId, 'user') || !receipt
    || receipt.environment !== 'sandbox' || receipt.state !== 'PROCESSED'
    || receipt.linkage !== 'LINKED'
    || !id(receipt.paymentId, 'pay')
    || !id(receipt.membershipId, 'mem')
    || !id(receipt.checkoutConfigurationId, 'ch')
    || !uuid(receipt.directAttemptId)
    || receipt.accountId !== SANDBOX.company
    || receipt.productId !== SANDBOX.product
    || receipt.planId !== SANDBOX.plan) return { status: 'REVIEW_REQUIRED' };

  if (!record(authenticatedMembershipReadback)) return { status: 'REVIEW_REQUIRED' };
  const m = authenticatedMembershipReadback;
  // Positive SaaS access evidence requires an active, provider-verified
  // membership for the signed-in Whop *user ID*. Matching emails or title
  // strings cannot prove ownership.
  if (m.id !== receipt.membershipId || m.checkout_configuration_id !== receipt.checkoutConfigurationId
    || !record(m.company) || m.company.id !== receipt.accountId
    || !record(m.plan) || m.plan.id !== receipt.planId
    || !record(m.product) || m.product.id !== receipt.productId
    || !record(m.user) || m.user.id !== authenticatedWhopUserId
    || m.status !== 'active' || m.currency !== 'usd'
    || !record(m.metadata)
    || typeof m.metadata.frameleads_direct_checkout_attempt_id !== 'string'
    || m.metadata.frameleads_direct_checkout_attempt_id.toLowerCase() !== receipt.directAttemptId.toLowerCase()
    || m.metadata.affiliate_verification !== 'NO_AFFILIATE'
    || m.metadata.frameleads_checkout_attempt_id !== undefined
    || m.metadata.frameleads_audit_linkage_id !== undefined
    || m.metadata.affiliate_code !== undefined
  ) return { status: 'REVIEW_REQUIRED' };

  // This is evidence that a *future protected Sandbox test* may assert.
  // No authenticated session is created and no tier/feature state is changed.
  return { status: 'EVIDENCE_MATCHED', tier: 'CORE', monthlyQuota: 500 };
}
