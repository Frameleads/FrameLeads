import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { hasFeatureAccess, normalizeFrameLeadsTier, requiredTierForFeature, type FeatureKey, type FrameLeadsTier } from '@/lib/entitlements';
import { headers } from 'next/headers';
import { localDevelopmentTierFor } from '@/lib/local-development-tier';
import { verifyCustomerSession } from '@/lib/customer-session';
import { verifyWhopSubscription } from '@/lib/whop-memberships';
import { createWhopEntitlementRefresher } from '@/lib/whop-entitlement-refresh';

const whopEntitlementRefresher = createWhopEntitlementRefresher({
  verify: verifyWhopSubscription,
  persist: async (userId, entitlement) => {
    await prisma.user.update({ where: { id: userId }, data: entitlement });
  },
});

export function invalidateWhopEntitlementCache(whopUserId: string) {
  whopEntitlementRefresher.invalidate(whopUserId);
}

function isSystemAdmin(email: string) {
  return Boolean(process.env.NEXT_PUBLIC_ADMIN_EMAIL)
    && email.trim().toLowerCase() === process.env.NEXT_PUBLIC_ADMIN_EMAIL!.trim().toLowerCase();
}

async function refreshedTier(input: {
  id: string; whopId: string; email: string; tier: string; monthlyQuota: number; accessToken?: string;
}) {
  if (await localDevelopmentTier()) return 'ENTERPRISE' as FrameLeadsTier;
  if (isSystemAdmin(input.email)) return 'ENTERPRISE' as FrameLeadsTier;
  if (!input.accessToken || !input.whopId || input.whopId.startsWith('auth-smoke:')) return normalizeFrameLeadsTier(input.tier);
  return normalizeFrameLeadsTier(await whopEntitlementRefresher.refresh({
    userId: input.id, whopUserId: input.whopId, accessToken: input.accessToken,
    currentTier: input.tier, currentMonthlyQuota: input.monthlyQuota,
  }));
}

async function localDevelopmentTier(): Promise<FrameLeadsTier | null> {
  if (process.env.NODE_ENV === 'production') return null;
  return localDevelopmentTierFor((await headers()).get('host'), process.env.NODE_ENV);
}

export async function getAuthenticatedEntitlementUser() {
  const jar = await cookies();
  const user = await resolveScoutUser(prisma, jar.get('frameleads_session')?.value);
  if (!user) return null;
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { tier: true, email: true, whopId: true, monthlyQuota: true } });
  if (!row) return null;
  const tier = await refreshedTier({ ...row, id: user.id, accessToken: jar.get('frameleads_session')?.value });
  return { id: user.id, tier };
}

export async function getUserEntitlementTier(userId: string): Promise<FrameLeadsTier> {
  if (await localDevelopmentTier()) return 'ENTERPRISE';
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true, email: true, whopId: true, monthlyQuota: true } });
  if (!row) return 'INACTIVE';
  if (isSystemAdmin(row.email)) return 'ENTERPRISE';
  const token = (await cookies()).get('frameleads_session')?.value;
  // Background integrations without a buyer session must fail closed: they
  // cannot refresh Whop OAuth membership and persisted tiers may be stale.
  if (!token) return 'INACTIVE';
  const sessionUser = await verifyCustomerSession(token);
  if (!sessionUser || sessionUser.id !== userId || sessionUser.whopId !== row.whopId) return 'INACTIVE';
  return refreshedTier({ ...row, id: userId, accessToken: token });
}

export async function requireFeatureAccess(feature: FeatureKey) {
  const user = await getAuthenticatedEntitlementUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  return featureAccessErrorForTier(user.tier, feature);
}

export function featureAccessErrorForTier(tier: FrameLeadsTier, feature: FeatureKey) {
  if (hasFeatureAccess(tier, feature)) return null;
  return NextResponse.json({ error: 'FEATURE_LOCKED', feature, requiredTier: requiredTierForFeature(feature) }, { status: 403 });
}

export const requireEnterpriseTier = () => requireFeatureAccess('GOVERNANCE');
export const requireCoreOrEnterpriseTier = () => requireFeatureAccess('INBOX_TRIAGE');
export const requireMinimumCoreTier = () => requireFeatureAccess('DECISION_REPLAY');
