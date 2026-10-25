import type { Prisma } from '@prisma/client';
import { invalidateWhopEntitlementCache } from './auth-guard';
import { membershipSubject } from './whop-memberships';

const MEMBERSHIP_EVENTS = new Set([
  'membership.activated',
  'membership.deactivated',
  'membership.cancel_at_period_end_changed',
  'membership.updated',
  'membership.went_valid',
  'membership.went_invalid',
  'membership_activated',
  'membership_cancelled',
  'membership_updated',
  'membership.cancelled',
  'payment.succeeded',
  'payment_succeeded',
  'payment.failed',
  'payment_failed',
  'payment.refunded',
  'payment_refunded',
  'refund.created',
  'refund.succeeded',
  'refund.updated',
]);

export type VerifiedWhopPayload = {
  type?: string;
  event?: string;
  action?: string;
  data?: Record<string, unknown>;
};

/**
 * Claim a signed delivery and force the next authenticated entitlement check
 * to read Whop's complete current membership view. A single event is never
 * enough to grant/revoke a user's tier: deliveries may be out of order and
 * the same buyer may hold another valid membership.
 */
export async function applyVerifiedWhopEvent(
  tx: Prisma.TransactionClient,
  webhookId: string,
  eventType: string,
  payload: unknown,
) {
  await tx.whopWebhookReceipt.create({ data: { webhookId, eventType } });
  if (!MEMBERSHIP_EVENTS.has(eventType)) return;
  const { whopId } = membershipSubject(payload);
  if (whopId) invalidateWhopEntitlementCache(whopId);
}
