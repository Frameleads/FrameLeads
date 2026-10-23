/**
 * REVIEW ONLY: fail-closed Whop Sandbox Core payment-lifecycle evidence.
 *
 * Not imported by production auth/entitlements, no network calls, no side
 * effects. Verified original checkout alone NEVER grants indefinite access.
 * Both payment status and current membership must come from authenticated
 * provider reads with fresh provenance, not a browser callback or JWT claims.
 *
 * Actual Whop API status/version normalization, renewals, grace periods,
 * chargebacks, refunds, Webhook retries and production entitlement revocation
 * must be separately approved and tested in a protected Sandbox preview.
 */
import {
  reviewSandboxCoreMembershipEvidence,
  type SandboxCoreAccessReviewEnv,
  type SandboxCoreVerifiedReceipt,
} from './whop-sandbox-core-access-review';

export type VerifiedSandboxPaymentLifecycle = {
  source: 'AUTHENTICATED_WHOP_READBACK';
  paymentId: string;
  membershipId: string;
  accountId: string;
  productId: string;
  planId: string;
  status: 'PAID' | 'PENDING' | 'FAILED' | 'REFUNDED' | 'DISPUTED' | 'CHARGEBACK' | 'UNKNOWN';
  checkedAtEpochSeconds: number;
  // True for *any* refund, dispute, or chargeback signal, including those
  // found through a separate dispute readback. Unknown must deny.
  adversePaymentSignal: boolean;
};
const providerId = (value: unknown, prefix: string): value is string =>
  typeof value === 'string' && new RegExp('^' + prefix + '_[A-Za-z0-9]{3,120}$').test(value);

export type CoreLifecycleReviewResult = {
  status: 'EVIDENCE_MATCHED_FOR_E2E' | 'REVIEW_REQUIRED' | 'DISABLED';
};

export function reviewSandboxCorePaymentLifecycleForE2E(
  env: SandboxCoreAccessReviewEnv,
  authenticatedWhopUserId: string,
  receipt: SandboxCoreVerifiedReceipt | null,
  authenticatedMembershipReadback: unknown,
  latestVerifiedPayment: VerifiedSandboxPaymentLifecycle | null,
  nowEpochSeconds: number,
): CoreLifecycleReviewResult {
  const membershipReview = reviewSandboxCoreMembershipEvidence(
    env, authenticatedWhopUserId, receipt, authenticatedMembershipReadback,
  );
  if (membershipReview.status !== 'EVIDENCE_MATCHED')
    return { status: membershipReview.status === 'DISABLED' ? 'DISABLED' : 'REVIEW_REQUIRED' };

  if (!latestVerifiedPayment
    || latestVerifiedPayment.source !== 'AUTHENTICATED_WHOP_READBACK'
    || !providerId(latestVerifiedPayment.paymentId, 'pay')
    || !receipt
    || latestVerifiedPayment.membershipId !== receipt.membershipId
    || latestVerifiedPayment.accountId !== receipt.accountId
    || latestVerifiedPayment.planId !== receipt.planId
    || latestVerifiedPayment.productId !== receipt.productId
    || latestVerifiedPayment.status !== 'PAID'
    || latestVerifiedPayment.adversePaymentSignal !== false
    || !Number.isSafeInteger(nowEpochSeconds)
    || !Number.isSafeInteger(latestVerifiedPayment.checkedAtEpochSeconds)
    || latestVerifiedPayment.checkedAtEpochSeconds > nowEpochSeconds + 30
    || nowEpochSeconds - latestVerifiedPayment.checkedAtEpochSeconds > 300)
    return { status: 'REVIEW_REQUIRED' };

  // Not a SaaS entitlement. Paid-at-time snapshot alone is insufficient
  // for actual subscription revocation, scheduled cancellation or renewals.
  return { status: 'EVIDENCE_MATCHED_FOR_E2E' };
}
