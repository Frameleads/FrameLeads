import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { hasFeatureAccess, normalizeFrameLeadsTier, requiredTierForFeature, type FeatureKey, type FrameLeadsTier } from '@/lib/entitlements';
import { headers } from 'next/headers';
import { localDevelopmentTierFor } from '@/lib/local-development-tier';

async function localDevelopmentTier(): Promise<FrameLeadsTier | null> {
  if (process.env.NODE_ENV === 'production') return null;
  return localDevelopmentTierFor((await headers()).get('host'), process.env.NODE_ENV);
}

export async function getAuthenticatedEntitlementUser() {
  const jar = await cookies();
  const user = await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value);
  if (!user) return null;
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { tier: true, email: true } });
  if (!row) return null;
  const isSystemAdmin = Boolean(process.env.NEXT_PUBLIC_ADMIN_EMAIL) &&
    row.email.trim().toLowerCase() === process.env.NEXT_PUBLIC_ADMIN_EMAIL!.trim().toLowerCase();
  return { id: user.id, tier: (await localDevelopmentTier()) ??
    (isSystemAdmin ? 'ENTERPRISE' : normalizeFrameLeadsTier(row.tier)) as FrameLeadsTier };
}

export async function getUserEntitlementTier(userId: string): Promise<FrameLeadsTier> {
  if (await localDevelopmentTier()) return 'ENTERPRISE';
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true, email: true } });
  if (!row) return 'INACTIVE';
  if (process.env.NEXT_PUBLIC_ADMIN_EMAIL && row.email.trim().toLowerCase() === process.env.NEXT_PUBLIC_ADMIN_EMAIL.trim().toLowerCase()) return 'ENTERPRISE';
  return normalizeFrameLeadsTier(row.tier);
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
