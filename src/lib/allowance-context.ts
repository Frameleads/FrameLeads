import { cookies } from 'next/headers';
import { prisma } from './prisma';
import { verifyWhopSubscription } from './whop-memberships';
import { AllowanceError, recurringTier } from './allowance-period';
import { allowanceMode, readProspectAllowance, enrollNewAllowanceTenant } from './prospect-allowance';
import { monthlyLeadQuotaForTier } from './entitlements';

/** Caller has already authenticated this exact tenant; no browser period is trusted. */
export async function getAllowanceContext(userId: string, tier: string) {
  if (!recurringTier(tier)) return null;
  const cursor = await prisma.prospectAllowanceCursor.findUnique({ where: { userId }, select: { userId: true, approvedPlanId: true } });
  let reviews: Array<{ planId: string; companyId: string; billingDays: number; reviewReference: string }> = [];
  let newAccountAfter: number | null = null;
  if (!cursor) {
    const after = process.env.PROSPECT_ALLOWANCE_NEW_ACCOUNTS_AFTER;
    if (allowanceMode() === 'disabled' || !after) return null;
    newAccountAfter = Date.parse(after);
    if (!after.endsWith('Z') || !Number.isFinite(newAccountAfter)) throw new AllowanceError('ALLOWANCE_CONFIGURATION_INVALID', 503);
    const account = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
    if (!account || account.createdAt.getTime() < newAccountAfter) return null;
    if (allowanceMode() === 'freeze') throw new AllowanceError('ALLOWANCE_RENEWAL_FROZEN', 503);
    try { reviews = JSON.parse(process.env.PROSPECT_ALLOWANCE_PLAN_REVIEWS || '[]'); } catch { throw new AllowanceError('ALLOWANCE_CONFIGURATION_INVALID', 503); }
    if (!Array.isArray(reviews) || !reviews.length || reviews.some(r => !r.planId || !r.companyId || !r.reviewReference || ![28,29,30,31].includes(r.billingDays)))
      throw new AllowanceError('ALLOWANCE_PLAN_REVIEW_REQUIRED', 503);
  }
  if (allowanceMode() === 'disabled') throw new AllowanceError('ALLOWANCE_ENROLLED_BUT_DISABLED', 503);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { whopId: true } });
  const token = (await cookies()).get('frameleads_session')?.value;
  if (!user || !token) throw new AllowanceError('ALLOWANCE_AUTHENTICATION_REQUIRED', 401);
  const subscription = await verifyWhopSubscription(token, user.whopId, fetch, cursor ? { planId: cursor.approvedPlanId } : { planIds: reviews.map(r => r.planId) });
  if (subscription.tier !== tier || !subscription.allowancePeriod)
    throw new AllowanceError('ALLOWANCE_PERIOD_VERIFICATION_REQUIRED', 503);
  if (!cursor) {
    const proof = subscription.allowancePeriod;
    const review = reviews.find(r => r.planId === proof.planId && r.companyId === proof.companyId && r.billingDays === proof.billingDays);
    if (!review || newAccountAfter === null) throw new AllowanceError('ALLOWANCE_PLAN_REVIEW_REQUIRED', 503);
    await enrollNewAllowanceTenant(prisma, userId, proof, newAccountAfter, review.reviewReference);
  }
  return { proof: subscription.allowancePeriod, snapshot: await readProspectAllowance(prisma, userId, subscription.allowancePeriod) };
}
export async function getAuthenticatedUsage(userId: string, tier: string, user: { leadsProcessed: number; microPilotOutboundUsed: number }) {
  const context = await getAllowanceContext(userId, tier);
  if (context) return context.snapshot;
  const limit = monthlyLeadQuotaForTier(tier);
  const used = tier === 'MICRO_PILOT' ? user.microPilotOutboundUsed : user.leadsProcessed;
  return { tier, limit, used, remaining: Math.max(0, limit - used), periodStart: null, periodEnd: null,
    state: tier === 'MICRO_PILOT' ? 'one-time' : 'legacy' };
}

/** Browsing history stays available during renewal outages; never advertise unverified remaining credit. */
export async function getDisplayedUsage(userId: string, tier: string, counters: { leadsProcessed: number; microPilotOutboundUsed: number }) {
  try { return await getAuthenticatedUsage(userId, tier, counters); }
  catch {
    const cursor = await prisma.prospectAllowanceCursor.findUnique({ where: { userId },
      include: { currentPeriod: true } });
    const used = cursor?.currentPeriod?.used ?? (tier === 'MICRO_PILOT' ? counters.microPilotOutboundUsed : counters.leadsProcessed);
    return { tier, limit: monthlyLeadQuotaForTier(tier), used, remaining: 0,
      periodStart: null, periodEnd: null, state: 'verification-required' as const };
  }
}
