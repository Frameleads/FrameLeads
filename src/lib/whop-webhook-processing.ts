import type { Prisma } from '@prisma/client';
import { resolveWhopSubscription } from './whop-subscription';
import { mergeWhopUserInTransaction } from './whop-user';

export type VerifiedWhopPayload = {
  id?: string;
  data?: {
    user?: { id?: string; email?: string };
    member?: { user?: { id?: string; email?: string } };
    membership?: { user?: { id?: string; email?: string } };
    user_id?: string;
    email?: string;
  };
};

const ACTIVE_EVENTS = new Set([
  'membership.activated', 'payment.succeeded', 'membership_activated',
  'payment_succeeded', 'membership_updated', 'membership.went_valid',
]);
const INACTIVE_EVENTS = new Set([
  'membership.deactivated', 'membership_cancelled', 'membership.went_invalid',
]);

function eventIdentity(payload: VerifiedWhopPayload) {
  const user = payload.data?.user || payload.data?.member?.user || payload.data?.membership?.user;
  return { whopId: user?.id || payload.data?.user_id, email: user?.email || payload.data?.email };
}

/** Claim the signed delivery and apply its entitlement update in one transaction. */
export async function applyVerifiedWhopEvent(
  tx: Prisma.TransactionClient,
  webhookId: string,
  eventType: string,
  payload: VerifiedWhopPayload,
) {
  await tx.whopWebhookReceipt.create({ data: { webhookId, eventType } });
  const { whopId, email } = eventIdentity(payload);
  if (!whopId) return;

  if (ACTIVE_EVENTS.has(eventType)) {
    if (!email) return;
    const subscription = resolveWhopSubscription(payload);
    await mergeWhopUserInTransaction(tx, { whopId, email, subscription });
  } else if (INACTIVE_EVENTS.has(eventType)) {
    // Signed Whop subject, never payload email, selects the single tenant.
    await tx.user.updateMany({
      where: { whopId },
      data: { tier: 'INACTIVE', monthlyQuota: 0 },
    });
  }
}
